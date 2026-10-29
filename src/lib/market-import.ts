import type { InstrumentKind, Market, Quote } from './market-types';

/** Strict, browser-safe quote CSV import. Quotes are never relabelled as official. */
export function parseQuoteCsv(text: string): Quote[] {
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('CSV 至少須含欄位名稱及一筆行情。');
  const header = rows[0].map((h) => h.trim());
  for (const key of ['symbol', 'name', 'price', 'asOf', 'market', 'kind']) {
    if (!header.includes(key)) throw new Error(`CSV 缺少必要欄位：${key}`);
  }
  if (new Set(header).size !== header.length) throw new Error('CSV 欄位名稱不可重複。');
  const seen = new Set<string>();
  return rows.slice(1).filter((row) => row.some((v) => v.trim())).map((row, i) => {
    if (row.length !== header.length) throw new Error(`第 ${i + 2} 列欄位數量錯誤。`);
    const item = Object.fromEntries(header.map((key, j) => [key, row[j].trim()]));
    if (!/^\d{4,6}[A-Z]?$/.test(item.symbol)) throw new Error(`第 ${i + 2} 列股票代號格式錯誤。`);
    if (seen.has(item.symbol)) throw new Error(`股票代號 ${item.symbol} 重複。`);
    seen.add(item.symbol);
    const price = Number(item.price.replaceAll(',', ''));
    if (!Number.isFinite(price) || price < 0.01 || price > 100_000_000
      || Math.abs(price * 100 - Math.round(price * 100)) > 0.00001) {
      throw new Error(`第 ${i + 2} 列價格須介於 0.01 與 100,000,000，且最多兩位小數。`);
    }
    if (!item.name || item.name.length > 100) throw new Error(`第 ${i + 2} 列名稱不正確。`);
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(item.asOf);
    const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(item.asOf);
    if ((!dayOnly && !isoTime) || Number.isNaN(Date.parse(item.asOf))) {
      throw new Error(`第 ${i + 2} 列 asOf 請填 YYYY-MM-DD 或含時區的 ISO 日期時間。`);
    }
    const datePart = item.asOf.slice(0, 10);
    if (new Date(`${datePart}T00:00:00Z`).toISOString().slice(0, 10) !== datePart) throw new Error(`第 ${i + 2} 列日期不存在。`);
    // A date-only record stays date-only; do not invent a precise quotation time.
    const asOf = item.asOf;
    const taipeiParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const taipeiToday = ['year', 'month', 'day'].map((type) => taipeiParts.find((part) => part.type === type)?.value).join('-');
    // Date-only records describe a Taiwan trading date, not midnight UTC.
    if (dayOnly ? asOf > taipeiToday : Date.parse(asOf) > Date.now() + 5 * 60_000) throw new Error(`第 ${i + 2} 列行情時間不可位於未來。`);
    if (!['TWSE', 'TPEx'].includes(item.market)) throw new Error(`第 ${i + 2} 列 market 須為 TWSE 或 TPEx。`);
    if (!['stock', 'etf', 'bond-etf'].includes(item.kind)) throw new Error(`第 ${i + 2} 列 kind 須為 stock、etf 或 bond-etf。`);
    const optional = (key: string) => {
      if (!item[key]) return null;
      const n = Number(item[key].replaceAll(',', ''));
      if (!Number.isFinite(n)) throw new Error(`第 ${i + 2} 列 ${key} 數值不正確。`);
      return n;
    };
    const change = optional('change');
    const volume = optional('volume');
    if (volume !== null && (volume < 0 || !Number.isInteger(volume))) throw new Error(`第 ${i + 2} 列成交股數須為非負整數。`);
    return {
      symbol: item.symbol, name: item.name, price, change,
      changePercent: change !== null && price - change > 0 ? change / (price - change) * 100 : null,
      volume, asOf, source: '使用者匯入（未經官方驗證）',
      market: item.market as Market, kind: item.kind as InstrumentKind, delayed: true,
    };
  });
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += c;
  }
  if (quoted) throw new Error('CSV 引號未閉合。');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}
