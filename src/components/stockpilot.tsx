"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type CSSProperties } from "react";
import { Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BriefcaseBusiness, Check, ChevronRight, CircleAlert, Download, Home, Info, LayoutGrid, Moon, Plus, RefreshCw, Search, Settings2, ShieldCheck, Star, Sun, Trash2, Upload, WifiOff, X } from "lucide-react";
import { createChart, CandlestickSeries, ColorType, type IChartApi } from "lightweight-charts";
import { calculatePortfolio, calculateTradeCosts, calculateRisk, getTaxRule, isSuspiciousTradePrice, DEFAULT_FEE_SETTINGS, type Transaction, type InstrumentKind, type FeeSettings } from "@/lib/finance";

type Tab = "overview" | "watchlist" | "analysis" | "portfolio" | "settings";
type Quote = { symbol: string; name: string; price: number; change: number | null; changePercent: number | null; volume: number | null; asOf: string; source: string; market: "TWSE" | "TPEx"; kind: InstrumentKind; delayed: true };
type IndexQuote = { name?: string; price?: number; value?: number; close?: number; change?: number | null; changePercent?: number | null; asOf?: string; source?: string };
type Candle = { time: string; open: number; high: number; low: number; close: number; volume: number };
type Saved = { version: 1; transactions: Transaction[]; watchlist: string[]; manualQuotes: Record<string, Quote>; fees: FeeSettings; theme: "light" | "dark" | "system"; accent: string };
import { parseQuoteCsv } from "@/lib/market-import";

const STORAGE = "stockpilot-tw-v1";
const QUOTE_CACHE = "stockpilot-tw-market-v1";
const tabs: { key: Tab; label: string; icon: typeof Home }[] = [{ key: "overview", label: "總覽", icon: LayoutGrid }, { key: "watchlist", label: "自選", icon: Star }, { key: "analysis", label: "分析", icon: Activity }, { key: "portfolio", label: "持倉", icon: BriefcaseBusiness }, { key: "settings", label: "設定", icon: Settings2 }];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const money = (n: number | null | undefined, decimals?: number) => n == null || !Number.isFinite(n) ? "—" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: decimals ?? 2, minimumFractionDigits: decimals ?? 0 }).format(n);
const signed = (n: number | null | undefined, decimals?: number) => n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n), decimals)}`;
const tone = (n: number | null | undefined) => n == null || n === 0 ? "neutral" : n > 0 ? "up" : "down";
const stamp = (d?: string) => { if (!d) return "尚無資料"; if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; const date = new Date(d); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : d; };
const kindName = (k: InstrumentKind) => k === "stock" ? "股票" : k === "bond-etf" ? "債券 ETF" : "ETF";
function accessibleAccent(hex: string, dark: boolean) {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map(value => parseInt(value, 16)) ?? [39, 118, 109];
  const luminance = (rgb: number[]) => rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrast = (a: number[], b: number[]) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const surface = dark ? [26, 48, 40] : [255, 255, 255];
  let color = channels;
  // Preserve the selected hue while keeping links and navigation readable.
  for (let step = 1; contrast(color, surface) < 4.5 && step <= 100; step++) color = channels.map(value => Math.round(value + ((dark ? 255 : 0) - value) * step / 100));
  return { color: `#${color.map(value => value.toString(16).padStart(2, "0")).join("")}`, foreground: contrast(color, [255, 255, 255]) >= contrast(color, [0, 0, 0]) ? "#ffffff" : "#000000" };
}
const defaults = (): Saved => ({ version: 1, transactions: [], watchlist: ["2330", "0050", "0056"], manualQuotes: {}, fees: { ...DEFAULT_FEE_SETTINGS }, theme: "system", accent: "#27766d" });
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function validQuote(value: unknown): value is Quote {
  if (!value || typeof value !== "object") return false;
  const q = value as Quote;
  return typeof q.symbol === "string" && /^[A-Za-z0-9]{2,12}$/.test(q.symbol) && typeof q.name === "string" && q.name.length > 0 && q.name.length <= 100 && Number.isFinite(q.price) && q.price >= .01 && q.price <= 100000000 && Math.abs(q.price * 100 - Math.round(q.price * 100)) < .00001 && typeof q.asOf === "string" && validDate(q.asOf.slice(0, 10)) && q.asOf.slice(0, 10) <= today() && ["TWSE", "TPEx"].includes(q.market) && ["stock", "etf", "bond-etf"].includes(q.kind);
}
function validateSaved(input: unknown): Saved {
  if (!input || typeof input !== "object") throw new Error("檔案格式不正確");
  const data = input as Saved;
  if (data.version !== 1 || !Array.isArray(data.transactions) || !Array.isArray(data.watchlist) || data.transactions.length > 20000) throw new Error("不支援的備份版本或交易數量");
  if (data.watchlist.some(s => typeof s !== "string" || !/^[A-Za-z0-9]{2,12}$/.test(s))) throw new Error("自選代號格式不正確");
  const ids = new Set<string>();
  for (const t of data.transactions) {
    if (!t || typeof t.id !== "string" || ids.has(t.id) || !/^[A-Za-z0-9]{2,12}$/.test(t.symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !["stock", "etf", "bond-etf"].includes(t.kind) || !["buy", "sell", "dividend"].includes(t.type)) throw new Error("交易資料不完整或重複");
    ids.add(t.id);
    if (t.type === "dividend") { if (!Number.isFinite(t.cashAmount) || t.cashAmount < 0) throw new Error("股利金額無效"); }
    else if (!Number.isFinite(t.price) || t.price <= 0 || !Number.isSafeInteger(t.quantity) || t.quantity <= 0) throw new Error("交易價格或股數無效");
  }
  const fees = { ...DEFAULT_FEE_SETTINGS, ...data.fees };
  if (![fees.commissionRate, fees.discount, fees.boardLotMinimum, fees.oddLotMinimum].every(n => Number.isFinite(n) && n >= 0) || fees.discount > 1 || fees.commissionRate > .05 || !["floor", "round", "ceil"].includes(fees.rounding)) throw new Error("手續費設定無效");
  const manualQuotes: Record<string, Quote> = {};
  for (const [s, q] of Object.entries(data.manualQuotes ?? {})) {
    if (!/^[A-Za-z0-9]{2,12}$/.test(s) || !validQuote({ ...q, symbol: s })) throw new Error("手動行情無效");
    manualQuotes[s] = { ...q, symbol: s, source: q.source?.startsWith("使用者匯入") ? "使用者匯入（未經官方驗證）" : "手動輸入", delayed: true };
  }
  calculatePortfolio(data.transactions, {}, { feeSettings: fees });
  return { version: 1, transactions: data.transactions, watchlist: data.watchlist, manualQuotes, fees, theme: ["light", "dark", "system"].includes(data.theme) ? data.theme : "system", accent: /^#[0-9a-f]{6}$/i.test(data.accent) ? data.accent : "#27766d" };
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function Badge({ children, kind = "muted" }: { children: React.ReactNode; kind?: string }) { return <span className={`badge ${kind}`}>{children}</span>; }
function Empty({ icon: Icon = BriefcaseBusiness, title, detail, action }: { icon?: typeof Home; title: string; detail: string; action?: React.ReactNode }) { return <div className="empty"><span className="empty-icon"><Icon size={24} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>; }
function CardHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) { return <div className="card-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</div>; }
function aggregate(candles: Candle[], period: string) {
  if (period === "day") return candles;
  const groups = new Map<string, Candle>();
  for (const c of candles) { const d = new Date(`${c.time}T00:00:00Z`); if (period === "week") d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); const key = period === "month" ? `${c.time.slice(0, 7)}-01` : d.toISOString().slice(0, 10); const prior = groups.get(key); groups.set(key, prior ? { ...prior, high: Math.max(prior.high, c.high), low: Math.min(prior.low, c.low), close: c.close, volume: prior.volume + c.volume } : { ...c, time: key }); }
  return [...groups.values()];
}
function PriceChart({ candles, period, dark }: { candles: Candle[]; period: string; dark: boolean }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!node.current || !candles.length) return;
    const chart: IChartApi = createChart(node.current, { autoSize: true, height: 260, layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: dark ? "#a9b7b1" : "#7a8580", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }, grid: { vertLines: { color: dark ? "#ffffff08" : "#172c2408" }, horzLines: { color: dark ? "#ffffff08" : "#172c2408" } }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false }, handleScale: { mouseWheel: false, pinch: true }, localization: { locale: "zh-TW" } });
    const series = chart.addSeries(CandlestickSeries, { upColor: "#d95d64", downColor: "#31856f", borderUpColor: "#d95d64", borderDownColor: "#31856f", wickUpColor: "#d95d64", wickDownColor: "#31856f" });
    series.setData(aggregate(candles, period).map(c => ({ ...c, time: c.time as `${number}-${number}-${number}` })));
    chart.timeScale().fitContent();
    const attribution = node.current.querySelector<HTMLAnchorElement>('a[href*="tradingview.com"]');
    attribution?.setAttribute("aria-label", "TradingView 圖表服務（開啟新視窗）");
    attribution?.setAttribute("rel", "noopener noreferrer");
    return () => chart.remove();
  }, [candles, period, dark]);
  return <div ref={node} className="chart" role="img" aria-label={`${period === "day" ? "日" : period === "week" ? "週" : "月"} K 線圖，共 ${candles.length} 筆真實歷史資料，紅漲綠跌`} />;
}

export default function StockPilot() {
  const [tab, setTab] = useState<Tab>("overview");
  const [analysisView, setAnalysisView] = useState<"chart" | "risk">("chart");
  const [tradeDiscount, setTradeDiscount] = useState(DEFAULT_FEE_SETTINGS.discount);
  const [saved, setSaved] = useState<Saved>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [storageWritable, setStorageWritable] = useState(true);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [index, setIndex] = useState<IndexQuote | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [cached, setCached] = useState(false);
  const [notice, setNotice] = useState("");
  const [modalError, setModalError] = useState("");
  const [refreshStatus, setRefreshStatus] = useState("");
  const refreshInFlight = useRef(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("2330");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [historyStatus, setHistoryStatus] = useState("");
  const [period, setPeriod] = useState("day");
  const [transactionOpen, setTransactionOpen] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  useEffect(() => {
    if (!transactionOpen && !manualOpen) return;
    setModalError("");
    const originalTrade = saved.transactions.find(t => t.id === editingTransactionId);
    setTradeDiscount(originalTrade?.type === "buy" || originalTrade?.type === "sell" ? originalTrade.feeSettings?.discount ?? saved.fees.discount : saved.fees.discount);
    const prior = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    const background = Array.from(document.querySelectorAll<HTMLElement>(".app-header,main,.bottom-nav"));
    const previousInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    let frame = 0;
    const resize = () => {
      document.documentElement.style.setProperty("--viewport-height", `${window.visualViewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty("--viewport-top", `${window.visualViewport?.offsetTop ?? 0}px`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active?.matches(".modal input,.modal select")) active.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    };
    resize(); window.visualViewport?.addEventListener("resize", resize); window.visualViewport?.addEventListener("scroll", resize);
    document.addEventListener("focusin", resize);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setTransactionOpen(false); setManualOpen(false); }
      if (event.key === "Tab") {
        const elements = Array.from(document.querySelectorAll<HTMLElement>('.modal button:not([disabled]),.modal input:not([type="hidden"]),.modal select,.modal summary')).filter(element => element.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && (document.activeElement === last || !document.activeElement?.closest(".modal"))) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    const id = window.setTimeout(() => document.querySelector<HTMLElement>(".modal .icon-button")?.focus(), 50);
    return () => { document.body.style.overflow = previousOverflow; document.body.style.overscrollBehavior = previousOverscroll; background.forEach((element, index) => { element.inert = previousInert[index]; }); window.visualViewport?.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("scroll", resize); document.removeEventListener("focusin", resize); document.documentElement.style.removeProperty("--viewport-height"); document.documentElement.style.removeProperty("--viewport-top"); document.removeEventListener("keydown", key); window.clearTimeout(id); cancelAnimationFrame(frame); prior?.focus({ preventScroll: true }); };
  }, [transactionOpen, manualOpen]);
  const [systemDark, setSystemDark] = useState(false);
  const [risk, setRisk] = useState({ entry: 100, quantity: 1000, stop: 95, target: 110, target2: 120, capital: 300000, maxLoss: 5000, slippage: .1, gap: 2, kind: "stock" as InstrumentKind });
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE); if (raw) setSaved(validateSaved(JSON.parse(raw))); const cache = localStorage.getItem(QUOTE_CACHE); if (cache) { const c = JSON.parse(cache); if (Array.isArray(c.quotes)) { setQuotes(c.quotes.filter((q: Quote) => validQuote(q))); setIndex(c.index ?? null); setCached(true); } } } catch { setStorageWritable(false); setNotice("儲存資料無法讀取，請匯入有效備份；目前未覆寫舊資料，也不會自動儲存。"); }
    setLoaded(true);
    const media = window.matchMedia("(prefers-color-scheme: dark)"); setSystemDark(media.matches); const themeChange = () => setSystemDark(media.matches); media.addEventListener("change", themeChange);
    const connection = () => setOffline(!navigator.onLine); connection(); window.addEventListener("online", connection); window.addEventListener("offline", connection);
    return () => { media.removeEventListener("change", themeChange); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); };
  }, []);
  useEffect(() => { if (loaded && storageWritable) try { localStorage.setItem(STORAGE, JSON.stringify(saved)); } catch { setNotice("瀏覽器儲存空間不足，請立即匯出備份。"); } }, [saved, loaded, storageWritable]);
  const dark = saved.theme === "dark" || (saved.theme === "system" && systemDark);
  const accent = useMemo(() => accessibleAccent(saved.accent, dark), [saved.accent, dark]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; document.documentElement.style.setProperty("--accent", accent.color); document.documentElement.style.setProperty("--accent-foreground", accent.foreground); }, [dark, accent]);
  async function refresh() {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    setRefreshStatus("正在更新行情，保留原有資料與畫面位置。");
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok && !data.quotes?.length) throw new Error(data.error ?? "行情服務目前無法連線");
      const incoming: Quote[] = Array.isArray(data.quotes) ? (data.quotes as unknown[]).filter(validQuote) : [];
      if (incoming.length) {
        setQuotes(incoming); setIndex(data.index ?? null); setCached(Boolean(data.cached));
        try { localStorage.setItem(QUOTE_CACHE, JSON.stringify({ quotes: incoming, index: data.index })); } catch {}
        setErrors(Array.isArray(data.errors) ? data.errors : []);
        const latestDate = [data.index?.asOf, ...incoming.map(q => q.asOf)].filter((v): v is string => typeof v === "string").sort().at(-1);
        setRefreshStatus(data.cached ? `官方來源部分失敗，保留快取；最新資料日期 ${latestDate ?? "不明"}。` : `已取得行情回應，最新資料日期 ${latestDate ?? "不明"}。${latestDate && latestDate.slice(0, 10) < today() ? " 目前仍非今日收盤資料。" : ""}`);
      } else {
        setCached(true);
        setErrors(data.errors?.length ? data.errors : ["目前沒有可取得的官方行情，請稍後重試或輸入帶日期的價格。"]);
        setRefreshStatus("無法取得新行情，保留先前報價與原始日期。");
      }
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "行情更新失敗"]); setCached(true);
      setRefreshStatus("行情更新失敗，保留先前報價與原始日期。");
    } finally { refreshInFlight.current = false; setLoading(false); }
  }
  useEffect(() => { void refresh(); const id = window.setInterval(() => { if (document.visibilityState === "visible" && navigator.onLine) void refresh(); }, 300000); return () => window.clearInterval(id); }, []);
  const quoteMap = useMemo(() => { const map: Record<string, Quote> = {}; for (const q of quotes) map[q.symbol] = q; for (const q of Object.values(saved.manualQuotes)) if (!map[q.symbol] || new Date(q.asOf).getTime() >= new Date(map[q.symbol].asOf).getTime()) map[q.symbol] = q; return map; }, [quotes, saved.manualQuotes]);
  const selectedQuote = quoteMap[selected];
  const portfolio = useMemo(() => {
    try { return calculatePortfolio(saved.transactions, Object.fromEntries(Object.values(quoteMap).map(q => [q.symbol, { price: q.price, date: q.asOf.slice(0, 10) }])), { feeSettings: saved.fees, asOfDate: today() }); }
    catch (e) { const result = calculatePortfolio(saved.transactions, {}, { feeSettings: saved.fees, asOfDate: today() }); return { ...result, warnings: [...result.warnings, `估值未完成：${e instanceof Error ? e.message : "請檢查報價與金額範圍"}`] }; }
  }, [saved.transactions, quoteMap, saved.fees]);
  const totals = portfolio.totals;
  const latestStockDate = quotes.reduce((latest, q) => q.asOf > latest ? q.asOf : latest, "");
  const marketDatesOlderThanToday = Boolean((latestStockDate && latestStockDate.slice(0, 10) < today()) || (index?.asOf && index.asOf.slice(0, 10) < today()));
  const flaggedPositions = portfolio.positions.filter(p => p.quantity > 0 && (
    (p.lastPrice !== null && isSuspiciousTradePrice(p.averageCost, p.lastPrice)) ||
    (quoteMap[p.symbol] && quoteMap[p.symbol].kind !== p.kind)
  ));
  const returnPct = totals.totalCost > 0 && totals.unrealizedPnl != null ? totals.unrealizedPnl / totals.totalCost * 100 : totals.missingQuotes.length ? null : 0;
  const filtered = Object.values(quoteMap).filter(q => !query.trim() || `${q.symbol}${q.name}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, query.trim() ? 30 : 15);
  const watching = saved.watchlist.map(s => quoteMap[s]).filter(Boolean);
  useEffect(() => {
    if (tab !== "analysis" || analysisView !== "chart") return;
    const controller = new AbortController(); setCandles([]); setHistoryStatus("正在讀取歷史行情…");
    fetch(`/api/history?symbol=${encodeURIComponent(selected)}&market=${selectedQuote?.market ?? "TWSE"}`, { signal: controller.signal }).then(r => r.json()).then(data => { if (controller.signal.aborted) return; setCandles(data.candles ?? []); setHistoryStatus(data.candles?.length ? `${data.source ?? "官方歷史資料"} · ${stamp(data.asOf)}` : data.errors?.[0] ?? "目前無可用歷史資料，圖表不會填入模擬行情。"); }).catch(e => { if (e.name !== "AbortError") setHistoryStatus("歷史資料連線失敗；可匯入券商匯出的日 K CSV。"); });
    return () => controller.abort();
  }, [selected, tab, selectedQuote?.market, analysisView]);
  function go(next: Tab) { setTab(next); setNotice(""); window.scrollTo({ top: 0, behavior: "instant" }); }
  function analyze(symbol: string) { setSelected(symbol); setAnalysisView("chart"); go("analysis"); }
  function showRisk() { setAnalysisView("risk"); go("analysis"); }
  function findStock() { go("watchlist"); window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label="搜尋股票代號或中文名稱"]')?.focus()); }
  function toggleWatch(symbol: string) { setSaved(s => ({ ...s, watchlist: s.watchlist.includes(symbol) ? s.watchlist.filter(x => x !== symbol) : [...s.watchlist, symbol] })); }
  const [txType, setTxType] = useState<"buy" | "sell" | "dividend">("buy");
  const editingTransaction = editingTransactionId ? saved.transactions.find(t => t.id === editingTransactionId) : undefined;
  function addTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const d = new FormData(event.currentTarget);
    const symbol = String(d.get("symbol")).trim().toUpperCase();
    const kind = d.get("kind") as InstrumentKind;
    const date = String(d.get("date"));
    try {
      if (!/^[A-Z0-9]{2,12}$/.test(symbol)) throw new Error("請輸入有效股票或 ETF 代號");
      if (!validDate(date) || date > today()) throw new Error("請確認有效且不晚於今天的交易日期");
      if (!["stock", "etf", "bond-etf"].includes(kind)) throw new Error("請先選擇正確的商品類型");
      const known = quoteMap[symbol];
      if (known && known.kind !== kind) throw new Error(`${symbol} 的官方商品類型為「${kindName(known.kind)}」，請先修正商品類型。`);
      const original = editingTransactionId ? saved.transactions.find(t => t.id === editingTransactionId) : undefined;
      if (editingTransactionId && !original) throw new Error("找不到原始交易，請重新開啟交易紀錄。");
      const base = { id: original?.id ?? crypto.randomUUID(), date, symbol, kind };
      const transaction: Transaction = txType === "dividend"
        ? { ...base, type: "dividend", cashAmount: Number(d.get("cashAmount")) }
        : { ...base, type: txType, price: Number(d.get("price")), quantity: Number(d.get("quantity")), oddLot: d.get("oddLot") === "on" ? true : undefined, feeSettings: { ...saved.fees, discount: Number(d.get("discount")) } };
      if (transaction.type !== "dividend" && known && isSuspiciousTradePrice(transaction.price, known.price)) {
        const ok = window.confirm(`請確認 ${symbol} 的每股成交價：${money(transaction.price, 2)} 元；官方參考收盤價為 ${money(known.price, 2)} 元（${known.asOf.slice(0, 10)}）。差距超過一倍，可能填入其他股票價格、每張總價或涉及分割。確認依原始成交紀錄儲存嗎？`);
        if (!ok) return;
      }
      const next = editingTransactionId
        ? saved.transactions.map(t => t.id === editingTransactionId ? transaction : t)
        : [...saved.transactions, transaction];
      calculatePortfolio(next, {}, { feeSettings: saved.fees });
      setSaved(previous => ({ ...previous, transactions: next, watchlist: previous.watchlist.includes(symbol) ? previous.watchlist : [...previous.watchlist, symbol] }));
      setSelected(symbol); setTransactionOpen(false); setEditingTransactionId(null); go("portfolio");
      setNotice(editingTransactionId ? "交易已修正，請對照券商成交紀錄確認成本。" : "交易已儲存，持倉已更新。");
    } catch (e) { setModalError(e instanceof Error ? e.message : "交易資料無法儲存"); }
  }
  function addManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const d = new FormData(event.currentTarget); const symbol = String(d.get("symbol")).trim().toUpperCase(); const price = Number(d.get("price")); const date = String(d.get("asOf"));
    if (!/^[A-Z0-9]{2,12}$/.test(symbol) || !Number.isFinite(price) || price < .01 || price > 100000000 || Math.abs(price * 100 - Math.round(price * 100)) > .00001 || !validDate(date) || date > today()) { setModalError("請確認代號、0.01–100,000,000 元且最多兩位小數的價格，以及不晚於今天的有效日期。"); return; }
    const q: Quote = { symbol, name: String(d.get("name")).trim() || quoteMap[symbol]?.name || symbol, price, change: null, changePercent: null, volume: null, asOf: date, source: "手動輸入", market: d.get("market") as "TWSE" | "TPEx", kind: d.get("kind") as InstrumentKind, delayed: true };
    setSaved(s => ({ ...s, manualQuotes: { ...s.manualQuotes, [symbol]: q }, watchlist: s.watchlist.includes(symbol) ? s.watchlist : [...s.watchlist, symbol] })); setSelected(symbol); setManualOpen(false); setNotice("已儲存手動價格；這不是即時行情。");
  }
  function removeTransaction(id: string) { try { const next = saved.transactions.filter(t => t.id !== id); calculatePortfolio(next, {}, { feeSettings: saved.fees }); setSaved(s => ({ ...s, transactions: next })); setNotice("已刪除交易，請核對持倉成本。"); } catch { setNotice("刪除此筆會使後續賣出超過庫存，請先刪除相關賣出交易。"); } }
  function exportData() { const blob = new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `StockPilot-TW-${today()}.json`; a.click(); URL.revokeObjectURL(url); }
  async function importData(file?: File) { if (!file) return; try { if (file.size > 5_000_000) throw new Error("備份檔不可超過 5 MB"); const next = validateSaved(JSON.parse(await file.text())); if (!window.confirm("匯入會取代目前裝置上的持倉與設定，是否繼續？")) return; setStorageWritable(true); setSaved(next); setNotice("備份已匯入。"); } catch (e) { setNotice(e instanceof Error ? e.message : "備份匯入失敗"); } }
  async function importQuoteCsv(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("行情 CSV 不可超過 5 MB");
      const imported = parseQuoteCsv(await file.text());
      if (!imported.every(validQuote)) throw new Error("行情 CSV 含有不支援的價格、日期或標的資料");
      const additions = Object.fromEntries(imported.map(q => [q.symbol, q]));
      setSaved(s => ({ ...s, manualQuotes: { ...s.manualQuotes, ...additions } }));
      setNotice(`已匯入 ${imported.length} 筆帶日期的行情，來源標記為使用者匯入。`);
    } catch (e) { setNotice(e instanceof Error ? e.message : "行情 CSV 匯入失敗"); }
  }
  async function importCandles(file?: File) { if (!file) return; try { if (file.size > 5000000) throw new Error("CSV 不可超過 5 MB"); const lines = (await file.text()).trim().replace(/^\uFEFF/, "").split(/\r?\n/); if (lines[0].toLowerCase() !== "date,open,high,low,close,volume") throw new Error("CSV 標頭須為 date,open,high,low,close,volume"); const parsed = lines.slice(1).filter(Boolean).map(line => { const [time, o, h, l, c, v] = line.split(",").map(s => s.trim()); const candle = { time, open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v ?? 0) }; if (!validDate(time) || time > today() || !Number.isInteger(candle.volume) || candle.volume < 0 || ![candle.open, candle.high, candle.low, candle.close].every(n => Number.isFinite(n) && n > 0) || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.low > candle.high) throw new Error("CSV 價格或日期格式錯誤"); return candle; }); if (!parsed.length) throw new Error("CSV 沒有日 K 資料"); parsed.sort((a, b) => a.time.localeCompare(b.time)); if (new Set(parsed.map(c => c.time)).size !== parsed.length) throw new Error("CSV 日期不可重複"); setCandles(parsed); setHistoryStatus(`使用者匯入 ${file.name} · 至 ${parsed.at(-1)?.time}，未經官方驗證`); } catch (e) { setNotice(e instanceof Error ? e.message : "CSV 匯入失敗"); } }
  let riskResult: { debit: number; loss: number; gain: number; gain2: number; breakEven: number | null; ratio: number | null; maxQuantity: number; commission: number; tax: number } | null = null;
  try {
    if (risk.target2 < risk.target) throw new Error("第二停利不可低於第一停利");
    const result = calculateRisk({ kind: risk.kind, entry: risk.entry, stop: risk.stop, target: risk.target, target2: risk.target2, userQuantity: risk.quantity, capital: risk.capital, riskPercent: risk.capital > 0 ? risk.maxLoss / risk.capital * 100 : 0, slippageBps: risk.slippage * 100, gapPercent: risk.gap, date: today(), feeSettings: saved.fees });
    const targetCosts = calculateTradeCosts({ side: "sell", kind: risk.kind, price: result.effectiveTarget, quantity: result.quantity, date: today(), feeSettings: saved.fees });
    riskResult = { debit: result.entryCash, loss: result.lossAtStop, gain: result.profitAtTarget, gain2: result.profitAtTarget2 ?? 0, breakEven: result.breakEvenPrice, ratio: result.rewardRiskRatio, maxQuantity: result.recommendedQuantity, commission: targetCosts.commission, tax: targetCosts.tax };
  } catch {}
  function QuoteRow({ quote, starred = false }: { quote: Quote; starred?: boolean }) { return <div className="quote-row"><button className="quote-main" onClick={() => analyze(quote.symbol)}><span className="symbol-avatar">{quote.symbol.slice(-2)}</span><span className="quote-name"><strong>{quote.name}</strong><small>{quote.symbol} <span>·</span> {quote.market === "TWSE" ? "上市" : "上櫃"} {kindName(quote.kind)}</small></span><span className="quote-price"><strong>{money(quote.price, 2)}</strong><small className={tone(quote.changePercent)}>{quote.changePercent == null ? `收盤 ${quote.asOf}` : `${signed(quote.changePercent, 2)}% · ${quote.asOf.slice(5)} 收盤`}</small></span></button><button className={`icon-button star-button ${starred ? "is-starred" : ""}`} onClick={() => toggleWatch(quote.symbol)} aria-label={`${starred ? "移除自選" : "加入自選"} ${quote.symbol}`}><Star size={19} fill={starred ? "currentColor" : "none"} /></button></div>; }
  function SaleCostDetails({ kind, price, quantity }: { kind: InstrumentKind; price: number | null; quantity: number }) {
    if (price == null || quantity <= 0) return null;
    const cost = calculateTradeCosts({ side: "sell", kind, price, quantity, date: today(), feeSettings: saved.fees });
    const rule = getTaxRule({ kind, date: today() });
    return <div className="sale-cost-details"><span>預估賣出手續費 <b>{money(cost.commission)} 元</b></span><span>證交稅 <b>{money(cost.tax)} 元（{money(cost.taxRate * 100, 2)}%）</b></span><small>{rule.label} · 估值日 {today()}{rule.effectiveTo ? ` · 至 ${rule.effectiveTo}` : ""}</small></div>;
  }
  const missingQuoteNotice = totals.missingQuotes.length > 0 ? <div className="missing-quote-notice"><p>{totals.missingQuotes.length} 檔持倉缺少參考價格，補入後顯示損益。</p><button className="text-button" onClick={() => { setSelected(totals.missingQuotes[0]); setManualOpen(true); }}>補入價格 <ChevronRight size={15} /></button></div> : null;
  return <div className="app-shell" style={{ "--accent": accent.color, "--accent-foreground": accent.foreground } as CSSProperties}>
    <header className="app-header"><button className="brand" onClick={() => go("overview")} aria-label="StockPilot TW 首頁"><span className="brand-mark"><Activity size={23} strokeWidth={2.2} /></span><span>StockPilot <b>TW</b></span></button><div className="header-actions"><span className="private-label"><ShieldCheck size={14} /> 個人投資工作站</span><button className="icon-button" aria-label="切換深淺色模式" onClick={() => setSaved(s => ({ ...s, theme: dark ? "light" : "dark" }))}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button><button className="icon-button avatar" onClick={() => go("settings")} aria-label="開啟個人設定">SP</button></div></header>
    <main id="main-content">
      <div className="page-intro"><h1>{tab === "overview" ? "投資總覽" : tab === "watchlist" ? "自選與搜尋" : tab === "analysis" ? "股票分析" : tab === "portfolio" ? "我的持倉" : "設定"}</h1><button className="refresh-button" onClick={refresh} disabled={loading} aria-busy={loading} aria-label="更新行情"><RefreshCw size={16} className={loading ? "spin" : ""} /><span>{loading ? "更新中" : "更新行情"}</span></button></div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{refreshStatus}</div><div className="status-strip"><span className={`status-dot ${offline ? "offline" : ""}`} />{offline ? "離線模式 · 僅顯示已快取資料" : "官方收盤資料 · 非即時報價"}<span className="status-date">資料至 {latestStockDate || index?.asOf || "尚無資料"}</span></div>
      {notice && <div className="notice" role="status"><CircleAlert size={18} /><span>{notice}</span><button className="icon-button" aria-label="關閉訊息" onClick={() => setNotice("")}><X size={18} /></button></div>}
      {offline && <div className="inline-info"><WifiOff size={16} /><span>離線價格保留原始時間，交易記錄仍可在此裝置使用。</span></div>}
      {marketDatesOlderThanToday && <div className="inline-info"><CircleAlert size={17} /><span>目前股票資料至 {latestStockDate || "未知"}；加權指數至 {index?.asOf || "未知"}。不是今日行情，請勿用於盤中決策；休市日可能正常顯示前一交易日。</span></div>}
      {flaggedPositions.length > 0 && <div className="notice" role="alert"><CircleAlert size={18} /><span>持倉 ${flaggedPositions.map(p => p.symbol).join("、")} 的成本與目前報價差距過大，或商品類型不一致。請到「持倉 → 交易紀錄 → 修改」核對原始成交資料；目前損益可能不正確。</span></div>}
      {refreshStatus && !loading && <div className="inline-info"><Info size={16} /><span>{refreshStatus}</span></div>}
      {errors.length > 0 && <details className="data-notice"><summary><CircleAlert size={15} />{quotes.length ? "部分資料來源暫時無法更新" : "官方資料暫時無法取得"}<ChevronRight size={15} /></summary><p>{errors.join("；")}</p><button className="text-button" onClick={() => setManualOpen(true)}>輸入帶日期的價格 <ArrowRight size={14} /></button></details>}
      {tab === "overview" && <>
        <section className="card portfolio-hero"><div className="hero-top"><span className="hero-section-name">我的投資</span><button className="hero-link" onClick={() => go("portfolio")} aria-label="查看持倉明細">持倉 <ChevronRight size={16} /></button></div><p className="hero-label">預估賣出淨損益 <span>TWD</span></p><div className="hero-amount">{signed(totals.unrealizedNetPnl)}</div><div className={`hero-performance ${tone(totals.unrealizedPnl)}`}><span>{signed(totals.unrealizedPnl)}</span><span className="hero-percent">{signed(returnPct, 2)}%</span><small>未實現損益</small></div><div className="hero-stats"><div><span>累積持倉成本</span><strong>NT$ {money(totals.totalCost)}</strong></div><div><span>持倉市值</span><strong>{money(totals.marketValue)}</strong></div><div><span>已實現損益</span><strong>{signed(totals.realizedPnl)}</strong></div><div><span>累計淨股利</span><strong>{money(totals.dividendIncome)}</strong></div></div></section>
        {missingQuoteNotice}
        <div className="quick-actions" aria-label="常用操作"><button className="outline-button" onClick={findStock}><Search size={20} /><span>查股票</span></button><button className="primary-button" onClick={() => { setTxType("buy"); setEditingTransactionId(null); setTransactionOpen(true); }}><Plus size={20} /><span>新增交易</span></button><button className="outline-button" onClick={showRisk}><ShieldCheck size={20} /><span>風險試算</span></button></div>
        <div className="overview-secondary"><section className="card market-overview" aria-label="市場概況"><CardHeading title="市場概況" /><div className="index-summary"><div><span>加權指數</span><small>{index ? stamp(index.asOf) : "尚無官方資料"}</small></div><div><strong className="market-number">{money(index?.price ?? index?.value ?? index?.close, 2)}</strong><span className={tone(index?.change)}>{index?.change == null ? "等待官方資料" : signed(index.change, 2)}</span></div></div></section><section className="card watch-card"><CardHeading title="我的自選" action={<button className="text-button" onClick={() => go("watchlist")}>全部 <ChevronRight size={16} /></button>} />{watching.length ? watching.slice(0, 3).map(q => <QuoteRow key={q.symbol} quote={q} starred />) : <div className="compact-empty"><p>尚無可用報價，自選代號已保留。</p><button className="text-button" onClick={() => go("watchlist")}>查看自選清單 <ChevronRight size={15} /></button></div>}<div className="card-footnote">{cached ? "快取行情 · " : ""}各標的報價時間請見詳細頁</div></section></div>
      </>}
      {tab === "watchlist" && <div className="content-grid"><section className="card"><CardHeading title="搜尋股票與 ETF" /><div className="search-box"><Search size={19} /><input aria-label="搜尋股票代號或中文名稱" placeholder="輸入代號或名稱" value={query} onChange={e => setQuery(e.target.value)} inputMode="search" /><button className="icon-button" aria-label="清除搜尋" disabled={!query} onClick={() => setQuery("")}><X size={17} /></button></div><div className="search-meta"><span>{query ? `符合搜尋的標的 · ${filtered.length}${filtered.length === 30 ? "+" : ""}` : "可用行情清單"}</span><button className="text-button" onClick={() => setManualOpen(true)}><Plus size={15} /> 手動價格</button></div>{filtered.length ? filtered.map(q => <QuoteRow key={q.symbol} quote={q} starred={saved.watchlist.includes(q.symbol)} />) : <Empty icon={Search} title={query ? "沒有符合的行情" : "尚無可用行情"} detail="可稍後更新，或輸入有日期的參考價格。新增交易與核心試算仍可使用。" action={<button className="outline-button" onClick={() => { setSelected(query || "2330"); setManualOpen(true); }}>輸入價格</button>} />}</section><section className="card"><CardHeading title="我的自選" action={<Badge>{saved.watchlist.length} 檔</Badge>} />{saved.watchlist.length ? saved.watchlist.map(s => quoteMap[s] ? <QuoteRow key={s} quote={quoteMap[s]} starred /> : <div className="missing-row" key={s}><button onClick={() => analyze(s)}><strong>{s}</strong><small>尚無可取得的報價</small></button><button className="icon-button is-starred" aria-label={`移除自選 ${s}`} onClick={() => toggleWatch(s)}><Star size={19} fill="currentColor" /></button></div>) : <Empty icon={Star} title="尚無自選標的" detail="搜尋後點星號加入，或輸入參考價格。" />}<p className="card-footnote">星號可加入或移除；點選標的開啟分析與報價明細。</p></section></div>}
      {tab === "portfolio" && <>
        <section className="card portfolio-summary"><div><p>預估全部賣出後淨損益</p><strong className={`large-number ${tone(totals.unrealizedNetPnl)}`}>{signed(totals.unrealizedNetPnl)} <small>TWD</small></strong></div><div className="portfolio-summary-actions"><button className="primary-button" onClick={() => { setTxType("buy"); setEditingTransactionId(null); setTransactionOpen(true); }}><Plus size={17} /> 新增交易</button><button className="outline-button" onClick={() => setManualOpen(true)}>更新手動價格</button></div><div className="metric-grid"><div><span>持倉市值</span><b>{money(totals.marketValue)}</b></div><div><span>持倉成本（含費）</span><b>{money(totals.totalCost)}</b></div><div><span>已實現損益</span><b className={tone(totals.realizedPnl)}>{signed(totals.realizedPnl)}</b></div><div><span>淨股利收入</span><b>{money(totals.dividendIncome)}</b></div><div><span>未實現損益</span><b className={tone(totals.unrealizedPnl)}>{signed(totals.unrealizedPnl)}</b></div><div><span>含息累積損益</span><b className={tone(totals.totalPnl)}>{signed(totals.totalPnl)}</b></div></div></section>
        {missingQuoteNotice}
        {portfolio.warnings.map((w, i) => <div className="inline-info" key={i}><Info size={16} /><span>{w}</span></div>)}
        <div className="content-grid"><section className="card"><CardHeading title="持倉明細" action={<Badge>{portfolio.positions.filter(p => p.quantity > 0).length} 檔</Badge>} />{portfolio.positions.filter(p => p.quantity > 0).length ? portfolio.positions.filter(p => p.quantity > 0).map(p => <article className="position" key={p.symbol}><div className="position-heading"><button onClick={() => analyze(p.symbol)}><strong>{quoteMap[p.symbol]?.name ?? p.symbol}</strong><small>{p.symbol} · {kindName(p.kind)} · {money(p.quantity)} 股</small></button><div className={tone(p.unrealizedNetPnl)}><b>{signed(p.unrealizedNetPnl)}</b><small>預估賣出淨損益</small></div></div><div className="position-metrics"><div><span>平均成本（含費）</span><b>{money(p.averageCost, 3)}</b></div><div><span>參考價格</span><b>{money(p.lastPrice, 2)}</b></div><div><span>市值</span><b>{money(p.marketValue)}</b></div><div><span>未實現報酬率</span><b className={tone(p.unrealizedPnl)}>{p.unrealizedPnl == null ? "—" : `${signed(p.totalCost ? p.unrealizedPnl / p.totalCost * 100 : 0, 2)}%`}</b></div></div><details className="disclosure position-details"><summary aria-label={`${p.symbol} 費稅明細`}>費稅明細</summary><SaleCostDetails kind={p.kind} price={p.lastPrice} quantity={p.quantity} /></details><div className="position-source">{quoteMap[p.symbol] ? `${quoteMap[p.symbol].source} · ${stamp(quoteMap[p.symbol].asOf)}` : "缺少報價，請輸入有日期的價格"}</div><div className="position-actions"><button className="text-button" onClick={() => { setSelected(p.symbol); setTxType("buy"); setEditingTransactionId(null); setTransactionOpen(true); }}>加碼</button><button className="text-button" onClick={() => { setSelected(p.symbol); setTxType("sell"); setEditingTransactionId(null); setTransactionOpen(true); }}>減碼</button><button className="text-button" onClick={() => { setSelected(p.symbol); setTxType("dividend"); setEditingTransactionId(null); setTransactionOpen(true); }}>記錄股利</button></div></article>) : <Empty title="尚無持倉" detail="新增買進紀錄，查看含手續費的持有成本。報價可稍後補入。" action={<button className="primary-button" onClick={() => { setTxType("buy"); setEditingTransactionId(null); setTransactionOpen(true); }}><Plus size={17} /> 新增第一筆交易</button>} />}</section><section className="card ledger-card"><details className="ledger-disclosure"><summary>交易紀錄 <span>{saved.transactions.length} 筆</span></summary><button className="text-button ledger-backup" onClick={exportData}><Download size={16} /> 備份</button>{saved.transactions.length ? [...saved.transactions].sort((a, b) => b.date.localeCompare(a.date)).map(t => <div className="transaction-row" key={t.id}><span className={`transaction-type ${t.type}`}>{t.type === "buy" ? <ArrowDownLeft size={18} /> : t.type === "sell" ? <ArrowUpRight size={18} /> : <Download size={18} />}</span><div><strong>{t.type === "buy" ? "買進" : t.type === "sell" ? "賣出" : "股利"} · {t.symbol}</strong><small>{t.date} {t.type === "dividend" ? "" : `· ${money(t.quantity)} 股 × ${money(t.price, 2)}`}</small></div><b>{t.type === "dividend" ? money(t.cashAmount) : money(t.price * t.quantity)}</b><button className="text-button" onClick={() => { setSelected(t.symbol); setTxType(t.type); setEditingTransactionId(t.id); setTransactionOpen(true); }} aria-label={`修改 ${t.date} ${t.symbol} 交易`}>修改</button><button className="icon-button" aria-label={`刪除 ${t.date} ${t.symbol} 交易`} onClick={() => { if (window.confirm("確定刪除此筆交易？無法復原，建議先匯出備份。")) removeTransaction(t.id); }}><Trash2 size={17} /></button></div>) : <p className="muted-text spaced">尚無交易紀錄。每一筆加碼、減碼與股利都會記錄於此。</p>}<p className="card-footnote">均價採移動加權成本法；股利單獨列帳。預估費稅可能因券商與交易方式而不同。</p></details></section></div>
      </>}
      {tab === "analysis" && <>
        <div className="segmented analysis-switch" aria-label="分析內容"><button aria-pressed={analysisView === "chart"} className={analysisView === "chart" ? "active" : ""} onClick={() => setAnalysisView("chart")}>走勢</button><button aria-pressed={analysisView === "risk"} className={analysisView === "risk" ? "active" : ""} onClick={() => setAnalysisView("risk")}>試算</button></div>
        {analysisView === "chart" && <>
        <section className="card analysis-card"><div className="analysis-top"><div><h2>{selectedQuote?.name ?? selected} <span className="stock-code">{selected}</span></h2><div className="quote-detail"><strong className={tone(selectedQuote?.change)}>{money(selectedQuote?.price, 2)}</strong><span className={tone(selectedQuote?.changePercent)}>{selectedQuote?.changePercent == null ? "尚無漲跌資料" : `${signed(selectedQuote.change, 2)} (${signed(selectedQuote.changePercent, 2)}%)`}</span></div></div><button className={`icon-button ${saved.watchlist.includes(selected) ? "is-starred" : ""}`} aria-label="切換此股票自選狀態" onClick={() => toggleWatch(selected)}><Star size={21} fill={saved.watchlist.includes(selected) ? "currentColor" : "none"} /></button></div><div className="analysis-toolbar"><label className="inline-select">標的<select aria-label="選擇分析標的" value={selected} onChange={e => setSelected(e.target.value)}>{[...new Set([selected, ...saved.watchlist, ...quotes.slice(0, 12).map(q => q.symbol)])].map(s => <option value={s} key={s}>{s} {quoteMap[s]?.name ?? ""}</option>)}</select></label><div className="segmented" aria-label="K 線週期">{[["day", "日 K"], ["week", "週 K"], ["month", "月 K"]].map(([key, label]) => <button key={key} className={period === key ? "active" : ""} onClick={() => setPeriod(key)}>{label}</button>)}</div></div>{candles.length ? <PriceChart candles={candles} period={period} dark={dark} /> : <div className="chart-empty"><Activity size={32} /><p>{historyStatus}</p><span>不以模擬行情替代真實資料</span></div>}<div className="chart-footer"><span>{candles.length ? historyStatus : "CSV 欄位：date,open,high,low,close,volume"}</span><label className="text-button file-label"><Upload size={15} /> 匯入日 K<input type="file" accept=".csv,text/csv" aria-label="匯入日 K CSV" onChange={e => { void importCandles(e.target.files?.[0]); e.target.value = ""; }} /></label></div><div className="data-provenance"><ShieldCheck size={15} /><span>{selectedQuote ? `${selectedQuote.source} · ${stamp(selectedQuote.asOf)} · 非即時報價${cached ? " · 快取" : ""}` : "尚無最新報價；請更新官方資料或手動輸入"}</span></div>{selectedQuote && <div className="quote-extra"><span>成交量 <b>{selectedQuote.volume == null ? "—" : `${money(selectedQuote.volume)} 股`}</b></span><span>市場 <b>{selectedQuote.market === "TWSE" ? "臺灣上市" : "臺灣上櫃"}</b></span><button className="text-button" onClick={() => { setRisk(r => ({ ...r, entry: selectedQuote.price, stop: Number((selectedQuote.price * .95).toFixed(2)), target: Number((selectedQuote.price * 1.1).toFixed(2)), target2: Number((selectedQuote.price * 1.2).toFixed(2)), kind: selectedQuote.kind })); setAnalysisView("risk"); setNotice("已帶入價格，可調整試算條件。"); }}>帶入試算 <ArrowRight size={14} /></button></div>}</section>
        </>}
        {analysisView === "risk" && <>
        <section className="card risk-card"><CardHeading title="風險試算" action={<span className="small-icon"><ShieldCheck size={20} /></span>} /><p className="section-description">依你設定的價格，計算交易成本與可能損失。</p>{riskResult && <div className="risk-preview"><div className="risk-primary"><span>停損情境預估損失</span><strong className="down">−{money(riskResult.loss)}</strong><small>含手續費、交易稅、滑價及設定跳空</small><span className={`risk-preview-status ${riskResult.loss > risk.maxLoss || riskResult.debit > risk.capital ? "exceeded" : "within"}`}>{riskResult.loss > risk.maxLoss ? "超過風險上限" : riskResult.debit > risk.capital ? "超過投資預算" : "在設定風險與預算內"}</span></div><div><span>風險報酬比</span><strong>1 : {money(riskResult.ratio, 2)}</strong></div></div>}<div className="risk-layout"><div className="risk-inputs"><div className="form-grid"><Field label="標的類型"><select value={risk.kind} onChange={e => setRisk(r => ({ ...r, kind: e.target.value as InstrumentKind }))}><option value="stock">股票</option><option value="etf">ETF</option><option value="bond-etf">債券 ETF</option></select></Field><Field label="進場價格（元）"><input aria-label="進場價格" type="number" inputMode="decimal" min="0.01" step="0.01" value={risk.entry} onChange={e => setRisk(r => ({ ...r, entry: Number(e.target.value) }))} /></Field><Field label="持有股數（股）"><input aria-label="持有股數" type="number" inputMode="numeric" min="1" step="1" value={risk.quantity} onChange={e => setRisk(r => ({ ...r, quantity: Number(e.target.value) }))} /></Field><Field label="單筆最大損失（元）"><input aria-label="最大可承受損失" type="number" inputMode="decimal" min="0" value={risk.maxLoss} onChange={e => setRisk(r => ({ ...r, maxLoss: Number(e.target.value) }))} /></Field></div><div className="slider-field"><div><label htmlFor="stop-price">停損參考價</label><input id="stop-price" aria-label="停損價格" type="number" inputMode="decimal" min="0.01" step="0.01" value={risk.stop} onChange={e => setRisk(r => ({ ...r, stop: Number(e.target.value) }))} /></div><input aria-label="停損價格滑桿" type="range" min={Math.max(.01, risk.entry * .5)} max={Math.max(.02, risk.entry * .999)} step="0.01" value={risk.stop} onChange={e => setRisk(r => ({ ...r, stop: Number(e.target.value) }))} /></div><div className="slider-field"><div><label htmlFor="target-price">第一停利參考價</label><input id="target-price" aria-label="第一停利價格" type="number" inputMode="decimal" min="0.01" step="0.01" value={risk.target} onChange={e => setRisk(r => ({ ...r, target: Number(e.target.value) }))} /></div><input aria-label="第一停利價格滑桿" type="range" min={Math.max(.01, risk.entry * 1.001)} max={Math.max(.02, risk.entry * 1.5)} step="0.01" value={risk.target} onChange={e => setRisk(r => ({ ...r, target: Number(e.target.value) }))} /></div><div className="form-grid"><Field label="第二停利價格（元）"><input aria-label="第二停利價格" type="number" inputMode="decimal" min="0.01" step="0.01" value={risk.target2} onChange={e => setRisk(r => ({ ...r, target2: Number(e.target.value) }))} /></Field></div><details className="disclosure risk-advanced"><summary><span>進階風險設定</span><small>預算 NT$ {money(risk.capital)} · 滑價 {money(risk.slippage)}% · 跳空 {money(risk.gap)}%</small></summary><div className="form-grid"><Field label="投資預算（元）"><input aria-label="投資金額" type="number" inputMode="decimal" min="0" value={risk.capital} onChange={e => setRisk(r => ({ ...r, capital: Number(e.target.value) }))} /></Field><Field label="單邊滑價（%）"><input aria-label="滑價比例" type="number" inputMode="decimal" min="0" max="10" step="0.1" value={risk.slippage} onChange={e => setRisk(r => ({ ...r, slippage: Number(e.target.value) }))} /></Field><Field label="停損跳空幅度（%）"><input aria-label="跳空風險" type="number" inputMode="decimal" min="0" max="50" step="0.1" value={risk.gap} onChange={e => setRisk(r => ({ ...r, gap: Number(e.target.value) }))} /></Field></div></details></div><div className="risk-results">{riskResult ? <><div className="risk-result-grid"><div><span>預計投入成本</span><b>{money(riskResult.debit)}</b></div><div><span>第一停利淨獲利</span><b className={tone(riskResult.gain)}>{signed(riskResult.gain)}</b></div><div><span>第二停利淨獲利</span><b className={tone(riskResult.gain2)}>{signed(riskResult.gain2)}</b></div><div><span>風險報酬比</span><b>1 : {money(riskResult.ratio, 2)}</b></div><div><span>損益兩平成交價</span><b>{money(riskResult.breakEven, 2)}</b></div><div><span>可承受部位大小</span><b>{money(riskResult.maxQuantity)} 股</b></div></div><div className={`risk-alert ${riskResult.loss > risk.maxLoss || riskResult.debit > risk.capital ? "exceeded" : "within"}`}><CircleAlert size={17} /><span>{riskResult.loss > risk.maxLoss ? "超過單筆風險上限，請減少股數或調整條件。" : riskResult.debit > risk.capital ? "投入成本超過投資預算。" : "在目前設定的預算與單筆風險範圍內。"}</span></div><button className="outline-button full-width" disabled={!riskResult.maxQuantity} onClick={() => setRisk(r => ({ ...r, quantity: riskResult!.maxQuantity }))}>套用可承受股數</button><p className="microcopy">分批停利尚未啟用；各情境以全部股數賣出。損益兩平成交價為實際成交所需價格，參考報價另須承擔賣出滑價。跳空可能超過設定幅度。</p></> : <Empty icon={CircleAlert} title="請確認試算條件" detail="需符合：停損低於進場，第一停利高於進場，第二停利不低於第一停利；股數為正整數。" />}</div></div></section>

        </>}
      </>}
      {tab === "settings" && <div className="settings-list"><details className="card settings-group" open><summary>外觀偏好</summary><div className="settings-content"><Field label="顯示模式"><select aria-label="顯示模式" value={saved.theme} onChange={e => setSaved(s => ({ ...s, theme: e.target.value as Saved["theme"] }))}><option value="system">跟隨系統</option><option value="light">淺色模式</option><option value="dark">深色模式</option></select></Field><div className="color-setting"><div><strong>自訂主題色</strong><p>主題色會自動調整明暗，維持文字對比；漲跌仍維持紅漲綠跌。</p></div><input type="color" aria-label="自訂主題色" value={saved.accent} onChange={e => setSaved(s => ({ ...s, accent: e.target.value }))} /></div></div></details><details className="card settings-group"><summary>資料與備份</summary><div className="settings-content"><p className="section-description">持倉與自選儲存在此瀏覽器，沒有上傳至帳號。清除 Safari 資料或更換裝置可能遺失，請定期備份。</p><div className="button-pair"><button className="outline-button" onClick={exportData}><Download size={17} /> 匯出備份</button><button className="outline-button" onClick={() => fileInput.current?.click()}><Upload size={17} /> 匯入備份</button><input ref={fileInput} type="file" accept="application/json,.json" aria-label="匯入投資資料備份" hidden onChange={e => { void importData(e.target.files?.[0]); e.target.value = ""; }} /></div><div className="quote-csv-import"><label className="outline-button file-label"><Upload size={16} /> 匯入行情 CSV<input type="file" accept=".csv,text/csv" aria-label="匯入行情 CSV" onChange={e => { void importQuoteCsv(e.target.files?.[0]); e.target.value = ""; }} /></label><p className="microcopy">必填欄位：symbol,name,price,asOf,market,kind。日期採 YYYY-MM-DD；market 填 TWSE 或 TPEx；kind 填 stock、etf 或 bond-etf。匯入資料不標記為官方行情。</p></div><div className="saved-data-info"><Check size={16} /><span>{saved.transactions.length} 筆交易 · {saved.watchlist.length} 檔自選 · {Object.keys(saved.manualQuotes).length} 筆手動報價</span></div>{Object.keys(saved.manualQuotes).length > 0 && <details className="manual-manage"><summary>管理手動報價</summary>{Object.values(saved.manualQuotes).map(q => <div className="manual-row" key={q.symbol}><span>{q.symbol} · {money(q.price, 2)}<small>{stamp(q.asOf)}</small></span><button className="icon-button" aria-label={`刪除 ${q.symbol} 手動報價`} onClick={() => setSaved(s => { const next = { ...s.manualQuotes }; delete next[q.symbol]; return { ...s, manualQuotes: next }; })}><Trash2 size={16} /></button></div>)}</details>}</div></details><details className="card settings-group"><summary>交易成本設定</summary><div className="settings-content"><p className="section-description">用於未填實際費用的估算。折扣 0.6 代表六折；最低手續費依券商及通路而異。</p><div className="form-grid"><Field label="手續費折扣（0–1）"><input aria-label="手續費折扣" type="number" min="0" max="1" step="0.01" inputMode="decimal" value={saved.fees.discount} onChange={e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) setSaved(s => ({ ...s, fees: { ...s.fees, discount: n } })); }} /></Field><Field label="基礎手續費率（%）"><input aria-label="基礎手續費率" type="number" min="0" max="5" step="0.0001" inputMode="decimal" value={Number((saved.fees.commissionRate * 100).toFixed(6))} onChange={e => { const n = Number(e.target.value) / 100; if (n >= 0 && n <= .05) setSaved(s => ({ ...s, fees: { ...s.fees, commissionRate: n } })); }} /></Field><Field label="整股最低手續費（元）"><input aria-label="整股最低手續費" type="number" min="0" step="1" inputMode="numeric" value={saved.fees.boardLotMinimum} onChange={e => { const n = Number(e.target.value); if (n >= 0 && n <= 100000) setSaved(s => ({ ...s, fees: { ...s.fees, boardLotMinimum: n } })); }} /></Field><Field label="零股最低手續費（元）"><input aria-label="零股最低手續費" type="number" min="0" step="1" inputMode="numeric" value={saved.fees.oddLotMinimum} onChange={e => { const n = Number(e.target.value); if (n >= 0 && n <= 100000) setSaved(s => ({ ...s, fees: { ...s.fees, oddLotMinimum: n } })); }} /></Field></div><Field label="手續費元以下處理"><select aria-label="手續費取整方式" value={saved.fees.rounding} onChange={e => setSaved(s => ({ ...s, fees: { ...s.fees, rounding: e.target.value as FeeSettings["rounding"] } }))}><option value="floor">無條件捨去</option><option value="round">四捨五入</option><option value="ceil">無條件進位</option></select></Field><div className="rule-note"><ShieldCheck size={18} /><div><strong>依交易日期適用交易稅</strong><p>一般股票賣出 0.3%；一般 ETF 0.1%。債券 ETF 免稅期間以規則設定為準。此版本不自動辨識當沖，交易紀錄預設一般交易。</p><p>債券 ETF 免稅模型期間：2017-01-01 至 2026-12-31；期滿後依一般 ETF 稅率。估值日期：{today()}。</p><p>新交易會保留當次手續費設定；調整設定不改寫既有交易。預估賣出使用目前設定。計算採新臺幣元；券商實際對帳單為準。</p></div></div></div></details><details className="card settings-group"><summary>加入 iPhone 主畫面</summary><div className="settings-content"><p>在 iPhone 上，用 Safari 開啟已部署的 HTTPS 網址：</p><ol className="install-steps"><li><span>1</span><p>點選 Safari 的「分享」按鈕。</p></li><li><span>2</span><p>選擇「加入主畫面」。</p></li><li><span>3</span><p>點選「新增」，就能像 App 一樣開啟。</p></li></ol><p className="microcopy">基本介面可離線使用；行情更新需要網路。尚未完成真實 iPhone Safari 驗收。</p></div></details><details className="card settings-group"><summary>關於與功能範圍</summary><div className="settings-content"><p className="section-description">使用 TWSE 與 TPEx 官方公開資料。以來源日期標記收盤價格，非即時報價；手動價格會明確註記。行情連線失敗時保留最後取得的資料。</p><div className="data-source-links"><a href="https://openapi.twse.com.tw/" target="_blank" rel="noreferrer">TWSE OpenAPI <ArrowUpRight size={14} /></a><a href="https://www.tpex.org.tw/" target="_blank" rel="noreferrer">證券櫃檯買賣中心 <ArrowUpRight size={14} /></a></div><div className="about-scope"><h3>目前可使用</h3><p>收盤行情、手動報價、持倉損益與費稅風險試算。</p><h3>尚未提供</h3><p>策略買賣訊號、技術指標、完整 ETF 含息分析、回測、AI 報告與提醒；本工具不自動下單。</p><p>持倉只保存在此裝置，沒有跨裝置同步。真實 iPhone Safari 仍待驗收。</p></div></div></details></div>}
      <footer className="page-footer"><span>StockPilot TW </span><small>行情非即時，試算不保證報酬。</small></footer>
    </main>
    <nav className="bottom-nav" aria-label="主要導覽">{tabs.map(({ key, label, icon: Icon }) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => go(key)}><span><Icon size={21} strokeWidth={tab === key ? 2.3 : 1.8} /></span><small>{label}</small></button>)}</nav>
    {(transactionOpen || manualOpen) && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { setTransactionOpen(false); setManualOpen(false); } }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-handle" /><div className="modal-header"><div><h2 id="modal-title">{manualOpen ? "輸入帶日期的價格" : editingTransactionId ? "修改交易紀錄" : "新增交易紀錄"}</h2></div><button className="icon-button" aria-label="關閉對話框" onClick={() => { setTransactionOpen(false); setManualOpen(false); }}><X size={21} /></button></div>{manualOpen ? <form onSubmit={addManual}><p className="section-description">請依券商或官方紀錄輸入。手動價格僅供個人試算，會清楚標記來源與日期。</p><div className="form-grid"><Field label="股票 / ETF 代號"><input name="symbol" aria-label="股票代號" required pattern="[A-Za-z0-9]{2,12}" defaultValue={selected} autoCapitalize="characters" /></Field><Field label="名稱（選填）"><input name="name" maxLength={100} aria-label="股票名稱" defaultValue={selectedQuote?.name ?? ""} /></Field><Field label="價格（元）"><input name="price" aria-label="手動報價" type="number" inputMode="decimal" min="0.01" max="100000000" step="0.01" required defaultValue={selectedQuote?.price} /></Field><Field label="報價日期"><input name="asOf" aria-label="報價日期" type="date" required max={today()} defaultValue={today()} /></Field><Field label="標的類型"><select name="kind" defaultValue={selectedQuote?.kind ?? "stock"}><option value="stock">股票</option><option value="etf">ETF</option><option value="bond-etf">債券 ETF</option></select></Field></div><details className="disclosure"><summary>交易市場</summary><Field label="交易市場"><select name="market" defaultValue={selectedQuote?.market ?? "TWSE"}><option value="TWSE">上市</option><option value="TPEx">上櫃</option></select></Field></details>{modalError && <p className="form-error" role="alert">{modalError}</p>}<button className="primary-button full-width" type="submit"><Check size={18} /> 儲存手動價格</button></form> : <form key={editingTransactionId ?? "new"} onSubmit={addTransaction}><div className="segmented transaction-tabs">{[["buy", "買進 / 加碼"], ["sell", "賣出 / 減碼"], ["dividend", "現金股利"]].map(([key, label]) => <button key={key} type="button" disabled={Boolean(editingTransactionId)} className={txType === key ? "active" : ""} onClick={() => { setTxType(key as typeof txType); setModalError(""); }}>{label}</button>)}</div><div className="form-grid"><Field label="股票 / ETF 代號"><input name="symbol" aria-label="股票代號" required pattern="[A-Za-z0-9]{2,12}" defaultValue={editingTransaction?.symbol ?? selected} autoCapitalize="characters" onChange={event => { const quote = quoteMap[event.currentTarget.value.trim().toUpperCase()]; const form = event.currentTarget.form; const price = form?.elements.namedItem("price") as HTMLInputElement | null; const kind = form?.elements.namedItem("kind") as HTMLSelectElement | null; if (price) price.value = quote ? String(quote.price) : ""; if (kind) kind.value = quote?.kind ?? ""; setModalError(""); }} /></Field><Field label="標的類型"><select name="kind" required defaultValue={editingTransaction?.kind ?? selectedQuote?.kind ?? ""}><option value="">請選擇正確類型</option><option value="stock">股票</option><option value="etf">ETF</option><option value="bond-etf">債券 ETF</option></select></Field><Field label={txType === "dividend" ? "入帳日期" : "交易日期"}><input name="date" aria-label="交易日期" type="date" required max={today()} defaultValue={editingTransaction?.date ?? today()} /></Field>{txType === "dividend" ? <Field label="實收現金股利（元）"><input name="cashAmount" aria-label="現金股利" type="number" inputMode="decimal" min="0" step="0.01" required defaultValue={editingTransaction?.type === "dividend" ? editingTransaction.cashAmount : undefined} /></Field> : <><Field label="成交價格（元）"><input name="price" aria-label="買入或賣出價格" type="number" inputMode="decimal" min="0.01" max="100000000" step="0.01" required defaultValue={editingTransaction && editingTransaction.type !== "dividend" ? editingTransaction.price : selectedQuote?.price} /></Field><Field label="成交股數（股）" hint="1 張 = 1,000 股，零股請直接填股數"><input name="quantity" aria-label="買入或賣出股數" type="number" inputMode="numeric" min="1" max="1000000000" step="1" required defaultValue={editingTransaction && editingTransaction.type !== "dividend" ? editingTransaction.quantity : 1000} /></Field></>}</div>{txType !== "dividend" && <details className="disclosure"><summary><span>費用與交易方式</span><small>本筆手續費 {money(tradeDiscount * 10, 2)} 折</small></summary><Field label="本筆手續費折扣（0–1）" hint="0.6 為六折，僅套用本筆交易"><input name="discount" aria-label="本次手續費折扣" type="number" inputMode="decimal" required min="0" max="1" step="0.01" value={tradeDiscount} onChange={e => setTradeDiscount(Number(e.target.value))} /></Field><label className="checkbox-field"><input name="oddLot" type="checkbox" defaultChecked={editingTransaction && editingTransaction.type !== "dividend" ? editingTransaction.oddLot : false} /><span>此筆為零股委託（未勾選時依股數自動拆分）</span></label></details>}<div className="inline-info"><Info size={17} /><span>賣出不得超過當時庫存；已實現損益依移動加權成本計算。</span></div>{modalError && <p className="form-error" role="alert">{modalError}</p>}<button className="primary-button full-width" type="submit"><Check size={18} /> {editingTransactionId ? "儲存修正" : "儲存交易"}</button></form>}</section></div>}
  </div>;
}
export { StockPilot };
