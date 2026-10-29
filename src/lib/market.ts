import 'server-only';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetch as httpFetch, ProxyAgent } from 'undici';
import type { Candle, HistoryResponse, InstrumentKind, Market, MarketIndex, MarketResponse, Quote } from './market-types';

export type { Candle, HistoryResponse, MarketResponse, Quote } from './market-types';

const TWSE = 'https://openapi.twse.com.tw/v1';
const TPEX = 'https://www.tpex.org.tw/openapi/v1';
const CACHE_TTL = 15 * 60_000;
const EMPTY_FAILURE_RETRY_TTL = 30_000;
const CACHE_FILE = join(process.cwd(), '.cache', 'official-market.json');
let memory: MarketResponse | null = null;
let inflight: Promise<MarketResponse> | null = null;
const proxyUri = process.env.HTTPS_PROXY || process.env.https_proxy;
const proxy = proxyUri ? new ProxyAgent(proxyUri) : undefined;

type Row = Record<string, unknown>;

async function officialJson(url: string): Promise<unknown> {
  const response = await httpFetch(url, {
    dispatcher: proxy,
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', 'User-Agent': 'StockPilotTW/1.0 personal-research' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 12_000_000) throw new Error('官方資料超出預期大小');
  return JSON.parse(body);
}

export function numberValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const cleaned = String(value).replaceAll(',', '').replaceAll(' ', '').replace(/^X/, '').trim();
  if (!cleaned || cleaned === '--' || cleaned === '---' || cleaned === '-' || cleaned === '+') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Taiwan official API dates may use ROC (115/10/28) or Gregorian years. */
export function officialDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  let y: number, m: number, d: number;
  const separated = text.match(/^(\d{2,4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const compact = text.match(/^(\d{3,4})(\d{2})(\d{2})$/);
  const match = separated || compact;
  if (!match) return null;
  y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  if (y < 1911) y += 1911;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function field(row: Row, ...keys: string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
}

function kindFromSymbol(symbol: string): InstrumentKind {
  if (symbol.startsWith('00') && symbol.endsWith('B')) return 'bond-etf';
  return symbol.startsWith('00') ? 'etf' : 'stock';
}

/** No trade date or a missing close means no quote: never substitute wall-clock dates. */
export function parseOfficialQuotes(data: unknown, market: Market): Quote[] {
  if (!Array.isArray(data)) throw new Error('官方行情回傳格式錯誤');
  const quotes: Quote[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Row;
    const symbol = String(field(row, 'Code', 'SecuritiesCompanyCode', 'SecuritiesCode', '證券代號', '股票代號') ?? '').trim();
    const name = String(field(row, 'Name', 'CompanyName', 'SecuritiesCompanyName', '證券名稱', '股票名稱') ?? '').trim();
    const price = numberValue(field(row, 'ClosingPrice', 'Close', '收盤價'));
    const asOf = officialDate(field(row, 'Date', '日期', '資料日期'));
    if (!/^\d{4,6}[A-Z]?$/.test(symbol) || !name || price === null || price < 0.01 || price > 100_000_000
      || Math.abs(price * 100 - Math.round(price * 100)) > 0.00001 || !asOf) continue;
    // Warrants/preferred shares are outside Phase 1 ordinary-stock/ETF scope.
    if (!symbol.startsWith('00') && !/^\d{4}$/.test(symbol)) continue;
    const change = numberValue(field(row, 'Change', '漲跌價差', '漲跌'));
    const previous = change === null ? null : price - change;
    quotes.push({
      symbol, name, price, change,
      changePercent: previous !== null && previous > 0 && change !== null ? change / previous * 100 : null,
      volume: numberValue(field(row, 'TradeVolume', 'TradingShares', '成交股數')),
      asOf, source: market === 'TWSE' ? '臺灣證券交易所・每日收盤' : '證券櫃檯買賣中心・每日收盤',
      market, kind: kindFromSymbol(symbol), delayed: true,
    });
  }
  if (!quotes.length) throw new Error('官方行情缺少可驗證的日期或收盤價，未顯示無日期報價');
  return quotes;
}

export function parseOfficialIndex(data: unknown): MarketIndex | null {
  if (!Array.isArray(data)) return null;
  const today = taipeiCalendar().today;
  return data.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return null;
    const item = raw as Row;
    const value = numberValue(field(item, 'TAIEX', '發行量加權股價指數'));
    const asOf = officialDate(field(item, 'Date', '日期'));
    return value !== null && value > 0 && asOf && asOf <= today ? {
      name: '加權指數', value, change: numberValue(field(item, 'Change', '漲跌點數')),
      asOf, source: '臺灣證券交易所・每日市場成交資訊',
    } : null;
  }).filter((v): v is MarketIndex => v !== null).sort((a, b) => b.asOf.localeCompare(a.asOf))[0] ?? null;
}

/** Null means this source could not provide usable data, preserving dated cache. */
export function mergeMarketSnapshots(previous: MarketResponse | null, current: {
  twse: Quote[] | null; tpex: Quote[] | null; index: MarketIndex | null;
}, fetchedAt = new Date().toISOString()): MarketResponse {
  const errors: string[] = [];
  const quotes: Quote[] = [];
  let cached = false;
  for (const [market, fresh] of [['TWSE', current.twse], ['TPEx', current.tpex]] as const) {
    if (fresh) quotes.push(...fresh);
    else {
      const fallback = previous?.quotes.filter((q) => q.market === market) ?? [];
      quotes.push(...fallback);
      cached ||= fallback.length > 0;
      errors.push(`${market === 'TWSE' ? '上市' : '上櫃'}官方收盤資料暫時無法取得（網路權限、來源維護或格式變更）；可匯入自行核對的行情 CSV。`);
    }
  }
  const index = current.index ?? previous?.index ?? null;
  if (!current.index) {
    errors.push('加權指數暫無可驗證的新資料。');
    cached ||= !!previous?.index;
  }
  return { quotes: quotes.sort((a, b) => a.symbol.localeCompare(b.symbol)), index, fetchedAt, errors, cached };
}

async function previousSnapshot(): Promise<MarketResponse | null> {
  if (memory) return memory;
  try {
    const candidate = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as MarketResponse;
    if (Array.isArray(candidate.quotes) && candidate.quotes.every((q) => q.asOf && q.source && q.price > 0)
      && !Number.isNaN(Date.parse(candidate.fetchedAt))) return candidate;
  } catch { /* No prior official response: return an explicit empty state. */ }
  return null;
}

async function refresh(): Promise<MarketResponse> {
  const previous = await previousSnapshot();
  const results = await Promise.allSettled([
    officialJson(`${TWSE}/exchangeReport/STOCK_DAY_ALL`).then((v) => parseOfficialQuotes(v, 'TWSE')),
    officialJson(`${TPEX}/tpex_mainboard_daily_close_quotes`).then((v) => parseOfficialQuotes(v, 'TPEx')),
    officialJson(`${TWSE}/exchangeReport/FMTQIK`).then(parseOfficialIndex),
  ]);
  const response = mergeMarketSnapshots(previous, {
    twse: results[0].status === 'fulfilled' ? results[0].value as Quote[] : null,
    tpex: results[1].status === 'fulfilled' ? results[1].value as Quote[] : null,
    index: results[2].status === 'fulfilled' ? results[2].value as MarketIndex | null : null,
  });
  memory = response;
  if (response.quotes.length || response.index) {
    try { await mkdir(join(process.cwd(), '.cache'), { recursive: true }); await writeFile(CACHE_FILE, JSON.stringify(response)); }
    catch { /* Read-only hosting still supports memory and browser caches. */ }
  }
  return response;
}

export async function getMarket(query = ''): Promise<MarketResponse> {
  let result = memory;
  // An entirely unavailable market should recover shortly after permissions or
  // connectivity return. Keep the normal cadence whenever usable data exists.
  const ttl = result && !result.quotes.length && !result.index && result.errors.length ? EMPTY_FAILURE_RETRY_TTL : CACHE_TTL;
  if (!result || Date.now() - Date.parse(result.fetchedAt) > ttl) {
    if (!inflight) inflight = refresh().finally(() => { inflight = null; });
    result = await inflight;
  }
  const q = query.trim().toLowerCase();
  return { ...result, quotes: q ? result.quotes.filter((quote) => quote.symbol.toLowerCase().includes(q) || quote.name.toLowerCase().includes(q)) : result.quotes };
}

export function parseTwseHistory(data: unknown): Candle[] {
  if (!data || typeof data !== 'object') throw new Error('歷史資料格式錯誤');
  const response = data as { stat?: string; data?: unknown[][] };
  if (!Array.isArray(response.data)) throw new Error('此月份無交易資料');
  const today = taipeiCalendar().today;
  return response.data.flatMap((row) => {
    const time = officialDate(row[0]);
    const [volume, open, high, low, close] = [row[1], row[3], row[4], row[5], row[6]].map(numberValue);
    if (!time || time > today || volume === null || !Number.isSafeInteger(volume) || volume < 0
      || open === null || high === null || low === null || close === null || Math.min(open, high, low, close) <= 0
      || high < Math.max(open, close) || low > Math.min(open, close) || low > high) return [];
    return [{ time, open, high, low, close, volume }];
  });
}

export function taipeiCalendar(now = new Date()): { year: number; month: number; today: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = parts.find((p) => p.type === 'day')?.value;
  return { year, month, today: `${year}-${String(month).padStart(2, '0')}-${day}` };
}

const historyCache = new Map<string, { at: number; result: HistoryResponse }>();
export async function getHistory(symbol: string, market: Market): Promise<HistoryResponse> {
  if (!/^\d{4,6}[A-Z]?$/.test(symbol)) return { candles: [], source: '', asOf: null, errors: ['股票代號格式錯誤。'] };
  if (market !== 'TWSE') return { candles: [], source: 'TPEx', asOf: null, errors: ['第一階段尚未接入上櫃歷史 K 線；仍可使用上櫃收盤行情與持倉計算。'] };
  const previous = historyCache.get(symbol);
  if (previous && Date.now() - previous.at < CACHE_TTL) return previous.result;
  const { year: currentYear, month: currentMonth } = taipeiCalendar();
  const candles: Candle[] = [], errors: string[] = [];
  // Two months supplies a useful chart while limiting public endpoint requests.
  for (let offset = 1; offset >= 0; offset--) {
    const month = new Date(Date.UTC(currentYear, currentMonth - 1 - offset, 1));
    const date = `${month.getUTCFullYear()}${String(month.getUTCMonth() + 1).padStart(2, '0')}01`;
    try {
      const payload = await officialJson(`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${encodeURIComponent(symbol)}`);
      candles.push(...parseTwseHistory(payload));
    } catch { errors.push(`${date.slice(0, 4)}/${date.slice(4, 6)} 歷史行情暫時無法取得。`); }
  }
  const sorted = [...new Map(candles.map((c) => [c.time, c])).values()].sort((a, b) => a.time.localeCompare(b.time));
  const result: HistoryResponse = { candles: sorted, source: '臺灣證券交易所・未還原每日 OHLCV', asOf: sorted.at(-1)?.time ?? null, errors };
  historyCache.set(symbol, { at: Date.now(), result });
  return result;
}
