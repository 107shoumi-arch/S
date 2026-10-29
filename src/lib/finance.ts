/**
 * Taiwan cash-equity estimates. Prices are NTD/share, quantities are shares,
 * percentages in FeeSettings are ratios (0.6 means 六折). Monetary totals are
 * rounded to cents; commission/tax are calculated separately in whole NTD.
 * Broker minimums and rounding are configurable, not statutory guarantees.
 * No margin, securities lending, splits, return of capital or FX is modelled.
 */
export type InstrumentKind = "stock" | "etf" | "bond-etf";
export type RoundingMode = "floor" | "round" | "ceil";

export interface FeeSettings {
  commissionRate: number;
  discount: number;
  boardLotMinimum: number;
  oddLotMinimum: number;
  rounding: RoundingMode;
}

export const DEFAULT_FEE_SETTINGS: Readonly<FeeSettings> = Object.freeze({
  commissionRate: 0.001425,
  discount: 0.6,
  boardLotMinimum: 20,
  oddLotMinimum: 1,
  rounding: "floor",
});

export interface TaxRule {
  id: string;
  label: string;
  rate: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  sourceUrl: string;
}

// Link by the exact law title rather than guessing an opaque statute ID.
const TAX_LAW = "https://law.moj.gov.tw/Law/LawSearchResult.aspx?ty=ONEBAR&kw=%E8%AD%89%E5%88%B8%E4%BA%A4%E6%98%93%E7%A8%85%E6%A2%9D%E4%BE%8B";

/** Dated statutory concessions; base rates resume when a concession expires. */
export const TAX_RULES: readonly TaxRule[] = Object.freeze([
  { id: "stock-standard", label: "股票一般賣出證交稅 0.3%", rate: 0.003, effectiveFrom: null, effectiveTo: null, sourceUrl: TAX_LAW },
  { id: "stock-day-trade", label: "符合條件之股票現股當沖賣出證交稅 0.15%", rate: 0.0015, effectiveFrom: "2017-04-28", effectiveTo: "2027-12-31", sourceUrl: TAX_LAW },
  { id: "etf-standard", label: "ETF 賣出證交稅 0.1%", rate: 0.001, effectiveFrom: null, effectiveTo: null, sourceUrl: TAX_LAW },
  { id: "bond-etf-exempt", label: "債券 ETF 暫停課徵證交稅", rate: 0, effectiveFrom: "2017-01-01", effectiveTo: "2026-12-31", sourceUrl: TAX_LAW },
]);

function requireFinite(value: number, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label}必須介於 ${minimum} 與 ${maximum} 之間。`);
  }
}

function requireDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期必須使用 YYYY-MM-DD 格式。");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error("請輸入有效日期。");
  return date;
}

function requireKind(kind: InstrumentKind): void {
  if (!["stock", "etf", "bond-etf"].includes(kind)) throw new Error("不支援的商品類型。");
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function money(value: number): number {
  const amount = cents(value);
  if (!Number.isSafeInteger(amount)) throw new Error("合計金額超過安全範圍，請分開計算。");
  return amount / 100;
}

/** Flag implausible entered per-share prices for explicit user confirmation.
 * This is only a warning: historical trades, splits, and corporate actions can
 * legitimately create a large gap from a current closing quote.
 */
export function isSuspiciousTradePrice(price: number, referencePrice: number): boolean {
  return Number.isFinite(price) && Number.isFinite(referencePrice)
    && price > 0 && referencePrice > 0
    && (price >= 2 * referencePrice || price <= referencePrice / 2);
}

export function todayTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function requireQuantity(quantity: number): void {
  requireFinite(quantity, "股數", 1, 1_000_000_000);
  if (!Number.isInteger(quantity)) throw new Error("股數必須是正整數。");
}

function requirePrice(price: number, allowZero = false): void {
  requireFinite(price, "價格", allowZero ? 0 : 0.01, 100_000_000);
  if (Math.abs(price - cents(price) / 100) > 1e-7) throw new Error("價格最多可輸入小數點後兩位。");
}

export function normalizeFeeSettings(settings: Partial<FeeSettings> = {}): FeeSettings {
  const result = { ...DEFAULT_FEE_SETTINGS, ...settings };
  requireFinite(result.commissionRate, "手續費率", 0, 0.1);
  requireFinite(result.discount, "手續費折扣", 0, 1);
  requireFinite(result.boardLotMinimum, "整股最低手續費", 0, 100_000);
  requireFinite(result.oddLotMinimum, "零股最低手續費", 0, 100_000);
  if (!["floor", "round", "ceil"].includes(result.rounding)) throw new Error("不支援的手續費取整方式。");
  return result;
}

export interface FeeRule {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  settings: Partial<FeeSettings>;
}

/** Latest effective start date wins; no matching rule uses caller defaults. */
export function selectFeeRule(date: string, rules: readonly FeeRule[]): FeeRule | null {
  requireDate(date);
  for (const rule of rules) {
    requireDate(rule.effectiveFrom);
    if (rule.effectiveTo && requireDate(rule.effectiveTo) < rule.effectiveFrom) throw new Error("費率規則結束日期不可早於生效日期。");
    normalizeFeeSettings(rule.settings);
  }
  const matches = rules.filter(rule => rule.effectiveFrom <= date && (!rule.effectiveTo || rule.effectiveTo >= date)).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  if (matches.length > 1 && matches[0].effectiveFrom === matches[1].effectiveFrom) throw new Error("同一日期有多筆衝突的費率規則。");
  return matches[0] ?? null;
}

export function getTaxRule(input: { kind: InstrumentKind; date: string; dayTrade?: boolean }): TaxRule & { warnings: string[] } {
  requireKind(input.kind);
  const date = requireDate(input.date);
  const warnings: string[] = [];
  let rule: TaxRule;
  if (input.kind === "stock") {
    const concession = TAX_RULES[1];
    if (input.dayTrade && date >= concession.effectiveFrom! && date <= concession.effectiveTo!) {
      rule = concession;
      warnings.push("當沖優惠須符合現股當日沖銷及標的資格；請以券商實際認定為準。");
    } else {
      rule = TAX_RULES[0];
      if (input.dayTrade) warnings.push("計算日期不在已建模的當沖減稅期間，依一般股票稅率估算。");
    }
  } else if (input.kind === "bond-etf" && date >= TAX_RULES[3].effectiveFrom! && date <= TAX_RULES[3].effectiveTo!) {
    rule = TAX_RULES[3];
  } else {
    rule = TAX_RULES[2];
    if (input.kind === "bond-etf") warnings.push("計算日期不在已建模的債券 ETF 免稅期間，依 ETF 一般稅率估算；法規展延須另行更新。");
  }
  return { ...rule, warnings };
}

const RATE_SCALE = 100_000_000n;

function scaledRate(value: number): bigint {
  return BigInt(Math.round(value * Number(RATE_SCALE)));
}

function roundFraction(numerator: bigint, denominator: bigint, mode: RoundingMode): number {
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (mode === "ceil" && remainder > 0n) rounded += 1n;
  if (mode === "round" && remainder * 2n >= denominator) rounded += 1n;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) throw new Error("計算金額超過安全範圍。");
  return result;
}

export interface TradeCostInput {
  side: "buy" | "sell";
  kind: InstrumentKind;
  price: number;
  quantity: number;
  date: string;
  oddLot?: boolean;
  dayTrade?: boolean;
  feeSettings?: Partial<FeeSettings>;
  feeRules?: readonly FeeRule[];
}

export interface TradeCosts {
  gross: number;
  commission: number;
  tax: number;
  /** Cash paid on buy; cash received on sell. */
  total: number;
  taxRate: number;
  taxRule: TaxRule;
  warnings: string[];
}

export function calculateTradeCosts(input: TradeCostInput): TradeCosts {
  requireQuantity(input.quantity);
  requirePrice(input.price, true);
  requireKind(input.kind);
  if (input.side !== "buy" && input.side !== "sell") throw new Error("交易方向必須為買進或賣出。");
  const ruleSettings = input.feeRules ? selectFeeRule(input.date, input.feeRules)?.settings : undefined;
  const fee = normalizeFeeSettings({ ...ruleSettings, ...input.feeSettings });
  if (input.oddLot === true && input.quantity >= 1_000) throw new Error("單筆零股委託必須少於 1,000 股。");
  if (input.oddLot === false && input.quantity % 1_000 !== 0) throw new Error("整股委託必須是 1,000 股的整數倍。");
  if (input.oddLot === undefined && input.quantity >= 1_000 && input.quantity % 1_000 !== 0) {
    const board = calculateTradeCosts({ ...input, quantity: Math.floor(input.quantity / 1_000) * 1_000, oddLot: false, feeSettings: fee });
    const odd = calculateTradeCosts({ ...input, quantity: input.quantity % 1_000, oddLot: true, feeSettings: fee });
    return { ...board, gross: money(board.gross + odd.gross), commission: money(board.commission + odd.commission), tax: money(board.tax + odd.tax), total: money(board.total + odd.total), warnings: [...new Set([...board.warnings, ...odd.warnings, "整股與零股按兩筆委託分別計收手續費及證交稅。"])] };
  }
  const selected = getTaxRule(input);
  const { warnings: taxWarnings, ...taxRule } = selected;
  const grossCents = BigInt(cents(input.price)) * BigInt(input.quantity);
  if (grossCents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("成交金額超過安全範圍。");
  const gross = Number(grossCents) / 100;
  const oddLot = input.oddLot ?? input.quantity < 1_000;
  const commission = Math.max(
    oddLot ? fee.oddLotMinimum : fee.boardLotMinimum,
    roundFraction(grossCents * scaledRate(fee.commissionRate) * scaledRate(fee.discount), 100n * RATE_SCALE * RATE_SCALE, fee.rounding),
  );
  // Whole-NTD tax truncation is a disclosed calculation convention; actual
  // settlement can be entered on the transaction through actualTax.
  const tax = input.side === "sell" ? roundFraction(grossCents * scaledRate(selected.rate), 100n * RATE_SCALE, "floor") : 0;
  return {
    gross,
    commission: money(commission),
    tax,
    total: money(input.side === "buy" ? gross + commission : gross - commission - tax),
    taxRate: input.side === "sell" ? selected.rate : 0,
    taxRule,
    warnings: input.side === "sell" ? taxWarnings : [],
  };
}

interface TransactionBase {
  id: string;
  date: string;
  symbol: string;
  kind: InstrumentKind;
}

export interface TradeTransaction extends TransactionBase {
  type: "buy" | "sell";
  quantity: number;
  price: number;
  oddLot?: boolean;
  dayTrade?: boolean;
  actualCommission?: number;
  actualTax?: number;
  /** Broker settings at recording time; preserve historical costs after edits. */
  feeSettings?: Partial<FeeSettings>;
}

export interface DividendTransaction extends TransactionBase {
  type: "dividend";
  cashAmount: number;
  withholdingTax?: number;
}

export type Transaction = TradeTransaction | DividendTransaction;
export interface Quote { price: number; date?: string }

export interface Position {
  symbol: string;
  kind: InstrumentKind;
  quantity: number;
  averageCost: number;
  totalCost: number;
  realizedPnl: number;
  dividendIncome: number;
  lastPrice: number | null;
  marketValue: number | null;
  netLiquidationValue: number | null;
  unrealizedPnl: number | null;
  unrealizedNetPnl: number | null;
  /** Realized + dividends + unrealized after estimated selling costs. */
  totalPnl: number | null;
}

export interface PortfolioTotals {
  totalCost: number;
  marketValue: number | null;
  netLiquidationValue: number | null;
  realizedPnl: number;
  dividendIncome: number;
  unrealizedPnl: number | null;
  unrealizedNetPnl: number | null;
  totalPnl: number | null;
  commissions: number;
  taxes: number;
  missingQuotes: string[];
}

export interface PortfolioResult {
  positions: Position[];
  totals: PortfolioTotals;
  warnings: string[];
}

/**
 * Process chronologically, preserving input order for trades on the same date.
 * Buy commissions enter weighted-average cost; sold cost is allocated to cents.
 * A final sale consumes the exact remaining cost. Dividends do not rewrite cost.
 * Short sales and mismatched instrument kinds are rejected. A missing quote
 * produces null valuation rather than substituting a price.
 */
export function calculatePortfolio(
  transactions: readonly Transaction[],
  quotes: Readonly<Record<string, Quote>> = {},
  options: { feeSettings?: Partial<FeeSettings>; feeRules?: readonly FeeRule[]; asOfDate?: string } = {},
): PortfolioResult {
  const feeSettings = normalizeFeeSettings(options.feeSettings);
  const asOfDate = requireDate(options.asOfDate ?? todayTaipei());
  const positions = new Map<string, Position>();
  const ids = new Set<string>();
  const warnings = new Set<string>();
  let commissions = 0;
  let taxes = 0;
  const ordered = transactions.map((transaction, index) => {
    requireDate(transaction.date);
    if (!transaction.id || ids.has(transaction.id)) throw new Error("每筆交易必須有不重複的識別碼。");
    ids.add(transaction.id);
    if (transaction.date > asOfDate) throw new Error("交易日期不可晚於估值日期。");
    if (!transaction.symbol.trim()) throw new Error("請輸入證券代號。");
    requireKind(transaction.kind);
    return { transaction, index };
  }).sort((a, b) => a.transaction.date.localeCompare(b.transaction.date) || a.index - b.index);

  for (const { transaction } of ordered) {
    const symbol = transaction.symbol.trim();
    let position = positions.get(symbol);
    if (!position) {
      position = { symbol, kind: transaction.kind, quantity: 0, averageCost: 0, totalCost: 0, realizedPnl: 0, dividendIncome: 0, lastPrice: null, marketValue: null, netLiquidationValue: null, unrealizedPnl: null, unrealizedNetPnl: null, totalPnl: null };
      positions.set(symbol, position);
    }
    if (position.kind !== transaction.kind) throw new Error(`${symbol} 的商品類型不一致。`);
    if (transaction.type === "dividend") {
      requireFinite(transaction.cashAmount, "配息金額");
      requireFinite(transaction.withholdingTax ?? 0, "配息扣繳金額", 0, transaction.cashAmount);
      position.dividendIncome = money(position.dividendIncome + transaction.cashAmount - (transaction.withholdingTax ?? 0));
      continue;
    }
    if (transaction.type !== "buy" && transaction.type !== "sell") throw new Error("不支援的交易類型。");
    requireQuantity(transaction.quantity);
    requirePrice(transaction.price);
    if (transaction.type === "sell" && transaction.quantity > position.quantity) throw new Error(`${symbol} 賣出股數超過當時持有股數。`);
    const datedSettings = options.feeRules ? selectFeeRule(transaction.date, options.feeRules)?.settings : undefined;
    const historicalSettings = normalizeFeeSettings({ ...feeSettings, ...datedSettings, ...transaction.feeSettings });
    const costs = calculateTradeCosts({ ...transaction, side: transaction.type, feeSettings: historicalSettings });
    if (transaction.actualCommission !== undefined) requireFinite(transaction.actualCommission, "實際手續費");
    if (transaction.actualTax !== undefined) requireFinite(transaction.actualTax, "實際證交稅");
    if (transaction.type === "buy" && (transaction.actualTax ?? 0) !== 0) throw new Error("買進交易不應有證券交易稅。");
    const commission = money(transaction.actualCommission ?? costs.commission);
    const tax = money(transaction.actualTax ?? costs.tax);
    commissions = money(commissions + commission);
    taxes = money(taxes + tax);
    for (const warning of costs.warnings) warnings.add(warning);
    if (transaction.type === "buy") {
      position.totalCost = money(position.totalCost + costs.gross + commission);
      position.quantity += transaction.quantity;
    } else {
      const allocatedCost = transaction.quantity === position.quantity ? position.totalCost : money(position.totalCost * transaction.quantity / position.quantity);
      position.realizedPnl = money(position.realizedPnl + costs.gross - commission - tax - allocatedCost);
      position.totalCost = money(position.totalCost - allocatedCost);
      position.quantity -= transaction.quantity;
    }
    position.averageCost = position.quantity ? position.totalCost / position.quantity : 0;
  }

  const missingQuotes: string[] = [];
  for (const position of positions.values()) {
    if (position.quantity === 0) {
      position.marketValue = 0;
      position.netLiquidationValue = 0;
      position.unrealizedPnl = 0;
      position.unrealizedNetPnl = 0;
      position.totalPnl = money(position.realizedPnl + position.dividendIncome);
      continue;
    }
    const quote = quotes[position.symbol];
    if (!quote) {
      missingQuotes.push(position.symbol);
      continue;
    }
    requirePrice(quote.price);
    if (quote.date && requireDate(quote.date) > asOfDate) throw new Error(`${position.symbol} 報價日期不可晚於估值日期。`);
    const currentDatedSettings = options.feeRules ? selectFeeRule(asOfDate, options.feeRules)?.settings : undefined;
    const liquidationSettings = normalizeFeeSettings({ ...feeSettings, ...currentDatedSettings });
    const liquidation = calculateTradeCosts({ side: "sell", kind: position.kind, price: quote.price, quantity: position.quantity, date: asOfDate, feeSettings: liquidationSettings });
    for (const warning of liquidation.warnings) warnings.add(warning);
    position.lastPrice = quote.price;
    position.marketValue = liquidation.gross;
    position.netLiquidationValue = liquidation.total;
    position.unrealizedPnl = money(liquidation.gross - position.totalCost);
    position.unrealizedNetPnl = money(liquidation.total - position.totalCost);
    position.totalPnl = money(position.realizedPnl + position.dividendIncome + position.unrealizedNetPnl);
  }
  const result = [...positions.values()];
  const sum = (field: "totalCost" | "realizedPnl" | "dividendIncome"): number => money(result.reduce((total, position) => total + position[field], 0));
  const valuedSum = (field: "marketValue" | "netLiquidationValue" | "unrealizedPnl" | "unrealizedNetPnl" | "totalPnl"): number | null => missingQuotes.length ? null : money(result.reduce((total, position) => total + (position[field] ?? 0), 0));
  return {
    positions: result,
    totals: { totalCost: sum("totalCost"), marketValue: valuedSum("marketValue"), netLiquidationValue: valuedSum("netLiquidationValue"), realizedPnl: sum("realizedPnl"), dividendIncome: sum("dividendIncome"), unrealizedPnl: valuedSum("unrealizedPnl"), unrealizedNetPnl: valuedSum("unrealizedNetPnl"), totalPnl: valuedSum("totalPnl"), commissions, taxes, missingQuotes },
    warnings: [...warnings],
  };
}

export interface RiskInput {
  kind: InstrumentKind;
  entry: number;
  stop: number;
  target: number;
  target2?: number;
  userQuantity?: number;
  capital: number;
  /** Percentage points: 1 means 1% of capital. */
  riskPercent: number;
  slippageBps: number;
  gapPercent: number;
  date: string;
  feeSettings?: Partial<FeeSettings>;
  maxAllocationPercent?: number;
}

export interface RiskResult {
  quantity: number;
  recommendedQuantity: number;
  boardLots: number;
  oddLotShares: number;
  riskBudget: number;
  entryCash: number;
  stopNet: number;
  targetNet: number;
  lossAtStop: number;
  profitAtTarget: number;
  target2Net: number | null;
  profitAtTarget2: number | null;
  exceedsRiskBudget: boolean;
  exceedsCapital: boolean;
  rewardRiskRatio: number | null;
  /** Minimum actual sell execution price covering entry cash; not an unslipped reference quote. */
  breakEvenPrice: number | null;
  capitalRequired: number;
  effectiveEntry: number;
  effectiveStop: number;
  effectiveTarget: number;
  perShareRisk: number;
  allocationPercent: number;
  warnings: string[];
}

function tickSize(price: number, kind: InstrumentKind): number {
  if (kind !== "stock") return price < 50 ? 0.01 : 0.05;
  return price < 10 ? 0.01 : price < 50 ? 0.05 : price < 100 ? 0.1 : price < 500 ? 0.5 : price < 1_000 ? 1 : 5;
}

/** Smallest valid exchange price tick whose estimated sell net covers cash cost. */
export function calculateBreakEvenPrice(input: { kind: InstrumentKind; quantity: number; entryCash: number; date: string; feeSettings?: Partial<FeeSettings> }): number {
  requireQuantity(input.quantity);
  requireFinite(input.entryCash, "買進總支出", 0.01);
  const roundTickUp = (price: number): number => {
    const tickCents = cents(tickSize(price, input.kind));
    return Math.ceil((price * 100 - 1e-8) / tickCents) * tickCents / 100;
  };
  // Fixed-point lower bounds avoid assuming sell net is strictly monotone at
  // whole-NTD fee jumps. Every skipped price is provably below the cash target.
  let price = roundTickUp(input.entryCash / input.quantity);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const sale = calculateTradeCosts({ side: "sell", kind: input.kind, price, quantity: input.quantity, date: input.date, feeSettings: input.feeSettings });
    if (sale.total >= input.entryCash) return price;
    price = roundTickUp(price + Math.max(0.01, (input.entryCash - sale.total) / input.quantity));
  }
  throw new Error("損益兩平價格無法收斂，請檢查費率設定。");
}

/**
 * Long-only cash position. Entry slips upward; stop/target slip downward; the
 * gap haircut applies additionally to the stop. Sizing includes all estimated
 * entry/exit fees, taxes and minimums and is bounded by both risk and cash.
 * Whole-lot and odd-lot portions are separate orders. Recommendation uses a
 * conservative fee bound for mixed sizes, so it is safe but not necessarily
 * the mathematically largest feasible size. userQuantity evaluates an actual
 * requested position independently and never silently clamps an unsafe size.
 */
export function calculateRisk(input: RiskInput): RiskResult {
  requireKind(input.kind);
  requireDate(input.date);
  requirePrice(input.entry);
  requirePrice(input.stop);
  requirePrice(input.target);
  if (input.stop >= input.entry) throw new Error("多頭停損價必須低於進場價。");
  if (input.target <= input.entry) throw new Error("多頭目標價必須高於進場價。");
  if (input.target2 !== undefined) {
    requirePrice(input.target2);
    if (input.target2 <= input.entry) throw new Error("第二目標價必須高於進場價。");
  }
  if (input.userQuantity !== undefined) requireQuantity(input.userQuantity);
  requireFinite(input.capital, "可用資金", 0.01, 1_000_000_000_000);
  requireFinite(input.riskPercent, "單筆風險比例", 0, 100);
  requireFinite(input.slippageBps, "滑價基點", 0, 5_000);
  requireFinite(input.gapPercent, "跳空風險比例", 0, 100);
  const allocationLimit = input.maxAllocationPercent ?? 100;
  requireFinite(allocationLimit, "資金配置上限", 0, 100);
  const feeSettings = normalizeFeeSettings(input.feeSettings);
  // Conservative cent rounding prevents optimistic fill-price rounding.
  const effectiveEntry = Math.ceil(cents(input.entry) * (1 + input.slippageBps / 10_000) - 1e-9) / 100;
  const effectiveStop = Math.floor(cents(input.stop) * (1 - input.slippageBps / 10_000) * (1 - input.gapPercent / 100) + 1e-9) / 100;
  const effectiveTarget = Math.floor(cents(input.target) * (1 - input.slippageBps / 10_000) + 1e-9) / 100;
  const riskBudget = Math.floor(cents(input.capital) * input.riskPercent / 100 + 1e-9) / 100;
  const cashLimit = Math.floor(cents(input.capital) * allocationLimit / 100 + 1e-9) / 100;
  const costsFor = (quantity: number, side: "buy" | "sell", price: number) => calculateTradeCosts({ side, kind: input.kind, quantity, price, date: input.date, feeSettings });
  const valuesFor = (quantity: number) => {
    const buy = costsFor(quantity, "buy", effectiveEntry);
    const stop = costsFor(quantity, "sell", effectiveStop);
    return { buy, stop, loss: money(buy.total - stop.total) };
  };
  // Broker minimum jumps at 1,000 shares can make the risk function discontinuous.
  // Both regions are monotone; check each to preserve maximal safe sizing.
  const maxPossible = Math.min(1_000_000_000, Math.floor(cashLimit / effectiveEntry));
  const conservativeValues = (quantity: number) => {
    const grossBuy = effectiveEntry * quantity;
    const grossStop = effectiveStop * quantity;
    const rate = feeSettings.commissionRate * feeSettings.discount;
    // For two split orders, the sum of individually rounded fees is at most
    // ceil(total raw fee)+1 plus both broker minima. This remains monotone.
    const commissionBound = (gross: number) => Math.ceil(gross * rate) + 1 + feeSettings.boardLotMinimum + feeSettings.oddLotMinimum;
    const buyTotal = money(grossBuy + commissionBound(grossBuy));
    const sellTax = Math.ceil(grossStop * getTaxRule({ kind: input.kind, date: input.date }).rate);
    return { buyTotal, loss: money(grossBuy - grossStop + commissionBound(grossBuy) + commissionBound(grossStop) + sellTax) };
  };
  const largestSafe = (from: number, to: number, mode: "odd" | "mixed" | "board"): number => {
    let low = from;
    let high = to;
    let best = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const q = mode === "board" ? middle * 1_000 : middle;
      const exact = mode === "mixed" ? undefined : valuesFor(q);
      const { buyTotal, loss } = exact ? { buyTotal: exact.buy.total, loss: exact.loss } : conservativeValues(q);
      if (buyTotal <= cashLimit && loss <= riskBudget) { best = q; low = middle + 1; }
      else high = middle - 1;
    }
    return best;
  };
  const recommendedQuantity = Math.max(largestSafe(1, Math.min(999, maxPossible), "odd"), maxPossible >= 1_000 ? largestSafe(1_000, maxPossible, "mixed") : 0, maxPossible >= 1_000 ? largestSafe(1, Math.floor(maxPossible / 1_000), "board") : 0);
  const quantity = input.userQuantity ?? recommendedQuantity;
  const warnings = ["情境估算不保證停損成交；跳空、流動性、漲跌停與券商實際費用可能使損失超過預算。", "建議股數對混合整股／零股採保守費用上界，不保證為最大可買股數。"];
  if (!quantity) return { quantity: 0, recommendedQuantity, boardLots: 0, oddLotShares: 0, riskBudget, entryCash: 0, stopNet: 0, targetNet: 0, lossAtStop: 0, profitAtTarget: 0, target2Net: null, profitAtTarget2: null, exceedsRiskBudget: false, exceedsCapital: false, rewardRiskRatio: null, breakEvenPrice: null, capitalRequired: 0, effectiveEntry, effectiveStop, effectiveTarget, perShareRisk: money(effectiveEntry - effectiveStop), allocationPercent: 0, warnings: [...warnings, "目前風險預算或可用資金不足以買進 1 股。"] };
  const { buy, stop, loss } = valuesFor(quantity);
  const target = costsFor(quantity, "sell", effectiveTarget);
  const target2 = input.target2 === undefined ? null : costsFor(quantity, "sell", Math.floor(cents(input.target2) * (1 - input.slippageBps / 10_000) + 1e-9) / 100);
  const profitAtTarget = money(target.total - buy.total);
  for (const warning of [...buy.warnings, ...stop.warnings, ...target.warnings]) if (!warnings.includes(warning)) warnings.push(warning);
  if (quantity >= 1_000 && quantity % 1_000) warnings.push("股數包含整股與零股，已按兩筆委託分別計算費用。");
  if (profitAtTarget <= 0) warnings.push("目標價在扣除交易成本與滑價後仍未獲利。");
  return { quantity, recommendedQuantity, boardLots: Math.floor(quantity / 1_000), oddLotShares: quantity % 1_000, riskBudget, entryCash: buy.total, stopNet: stop.total, targetNet: target.total, lossAtStop: loss, profitAtTarget, target2Net: target2?.total ?? null, profitAtTarget2: target2 ? money(target2.total - buy.total) : null, exceedsRiskBudget: loss > riskBudget, exceedsCapital: buy.total > cashLimit, rewardRiskRatio: loss > 0 ? profitAtTarget / loss : null, breakEvenPrice: calculateBreakEvenPrice({ kind: input.kind, quantity, entryCash: buy.total, date: input.date, feeSettings }), capitalRequired: buy.total, effectiveEntry, effectiveStop, effectiveTarget, perShareRisk: loss / quantity, allocationPercent: buy.total / input.capital * 100, warnings };
}
