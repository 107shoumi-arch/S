import { describe, expect, it, vi } from "vitest";
import {
  calculateBreakEvenPrice,
  calculatePortfolio,
  calculateRisk,
  calculateTradeCosts,
  getTaxRule,
  isSuspiciousTradePrice,
  selectFeeRule,
  todayTaipei,
  type FeeSettings,
  type Transaction,
} from "./finance";

describe("trade-entry price confirmation", () => {
  it("flags 0050 accidentally entered at a 2330-sized price", () => {
    expect(isSuspiciousTradePrice(2425, 108.65)).toBe(true);
    expect(isSuspiciousTradePrice(108.65, 108.65)).toBe(false);
    expect(isSuspiciousTradePrice(105, 108.65)).toBe(false);
    expect(isSuspiciousTradePrice(20, 108.65)).toBe(true);
    expect(isSuspiciousTradePrice(0, 108.65)).toBe(false);
  });
});

const DATE = "2026-10-28";
const NO_FEES: FeeSettings = { commissionRate: 0, discount: 1, boardLotMinimum: 0, oddLotMinimum: 0, rounding: "floor" };
const defaultTrade = { kind: "stock" as const, date: DATE, price: 100, quantity: 1_000 };

describe("Taiwan fee and dated tax rules", () => {
  it("charges commission on both sides and stock transaction tax only on sale", () => {
    expect(calculateTradeCosts({ ...defaultTrade, side: "buy" })).toMatchObject({ gross: 100_000, commission: 85, tax: 0, total: 100_085 });
    expect(calculateTradeCosts({ ...defaultTrade, side: "sell" })).toMatchObject({ gross: 100_000, commission: 85, tax: 300, total: 99_615 });
  });

  it("uses separate configurable odd-lot and whole-lot minimums", () => {
    expect(calculateTradeCosts({ ...defaultTrade, side: "buy", price: 1, quantity: 1 }).commission).toBe(1);
    expect(calculateTradeCosts({ ...defaultTrade, side: "buy", price: 1 }).commission).toBe(20);
    const mixed = calculateTradeCosts({ ...defaultTrade, side: "buy", price: 1, quantity: 1_001 });
    expect(mixed.commission).toBe(21);
    expect(mixed.total).toBe(1_022);
    expect(() => calculateTradeCosts({ ...defaultTrade, side: "buy", quantity: 1_001, oddLot: true })).toThrow("零股");
    expect(() => calculateTradeCosts({ ...defaultTrade, side: "buy", quantity: 99, oddLot: false })).toThrow("整股");
  });

  it("calculates decimal prices without binary floating-point fee drift", () => {
    expect(calculateTradeCosts({ ...defaultTrade, side: "buy", price: 19.95, quantity: 999, feeSettings: NO_FEES }).gross).toBe(19_930.05);
    const fullRate = calculateTradeCosts({ ...defaultTrade, side: "buy", feeSettings: { discount: 1 } });
    expect(fullRate.commission).toBe(142);
    expect(calculateTradeCosts({ ...defaultTrade, side: "buy", feeSettings: { discount: 1, rounding: "round" } }).commission).toBe(143);
  });

  it("applies day-trading concessions only inside their effective dates", () => {
    expect(getTaxRule({ kind: "stock", date: "2017-04-27", dayTrade: true }).rate).toBe(0.003);
    expect(getTaxRule({ kind: "stock", date: "2017-04-28", dayTrade: true }).rate).toBe(0.0015);
    expect(getTaxRule({ kind: "stock", date: "2027-12-31", dayTrade: true }).rate).toBe(0.0015);
    expect(getTaxRule({ kind: "stock", date: "2028-01-01", dayTrade: true })).toMatchObject({ rate: 0.003, warnings: expect.any(Array) });
    expect(getTaxRule({ kind: "etf", date: DATE, dayTrade: true }).rate).toBe(0.001);
  });

  it("distinguishes ETFs from the dated bond ETF exemption", () => {
    expect(calculateTradeCosts({ ...defaultTrade, side: "sell", kind: "etf" }).tax).toBe(100);
    expect(calculateTradeCosts({ ...defaultTrade, side: "sell", kind: "bond-etf" }).tax).toBe(0);
    expect(getTaxRule({ kind: "bond-etf", date: "2027-01-01" }).rate).toBe(0.001);
  });

  it("selects dated broker rules without inventing a matching rule", () => {
    const rules = [
      { id: "old", label: "舊費率", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31", settings: { discount: 1 } },
      { id: "new", label: "新費率", effectiveFrom: "2026-01-01", settings: { discount: 0.28 } },
    ];
    expect(selectFeeRule("2024-12-31", rules)).toBeNull();
    expect(selectFeeRule("2025-12-31", rules)?.id).toBe("old");
    expect(selectFeeRule("2026-01-01", rules)?.settings.discount).toBe(0.28);
    expect(calculateTradeCosts({ ...defaultTrade, side: "buy", feeRules: rules }).commission).toBe(39);
  });

  it("rejects invalid dates, quantities and unsupported prices", () => {
    expect(() => getTaxRule({ kind: "stock", date: "2026-02-30" })).toThrow("日期");
    expect(() => calculateTradeCosts({ ...defaultTrade, side: "buy", quantity: 0 })).toThrow("股數");
    expect(() => calculateTradeCosts({ ...defaultTrade, side: "buy", quantity: 1.5 })).toThrow("股數");
    expect(() => calculateTradeCosts({ ...defaultTrade, side: "buy", price: Number.NaN })).toThrow("價格");
    expect(() => calculateTradeCosts({ ...defaultTrade, side: "buy", price: 1.001 })).toThrow("兩位");
  });
});

describe("sequential weighted-average portfolio", () => {
  const trades: Transaction[] = [
    { id: "b1", type: "buy", symbol: "2330", kind: "stock", date: "2026-10-01", price: 100, quantity: 1_000, actualCommission: 20 },
    { id: "b2", type: "buy", symbol: "2330", kind: "stock", date: "2026-10-02", price: 120, quantity: 1_000, actualCommission: 20 },
    { id: "s1", type: "sell", symbol: "2330", kind: "stock", date: "2026-10-03", price: 130, quantity: 500, actualCommission: 10, actualTax: 195 },
    { id: "d1", type: "dividend", symbol: "2330", kind: "stock", date: "2026-10-04", cashAmount: 1_000, withholdingTax: 100 },
  ];

  it("includes buy fees in cost and allocates sold cost before recording net realized return", () => {
    const result = calculatePortfolio(trades, { "2330": { price: 125, date: DATE } }, { asOfDate: DATE });
    expect(result.positions[0]).toMatchObject({ quantity: 1_500, averageCost: 110.02, totalCost: 165_030, realizedPnl: 9_785, dividendIncome: 900, marketValue: 187_500 });
    const liquidation = calculateTradeCosts({ side: "sell", kind: "stock", quantity: 1_500, price: 125, date: DATE });
    expect(result.positions[0].netLiquidationValue).toBe(liquidation.total);
    expect(result.positions[0].totalPnl).toBe(9_785 + 900 + liquidation.total - 165_030);
    expect(result.totals).toMatchObject({ commissions: 50, taxes: 195, realizedPnl: 9_785, missingQuotes: [] });
  });

  it("never substitutes an absent quote with a mock price or zero", () => {
    const result = calculatePortfolio(trades, {}, { asOfDate: DATE });
    expect(result.positions[0].lastPrice).toBeNull();
    expect(result.positions[0].marketValue).toBeNull();
    expect(result.totals.totalPnl).toBeNull();
    expect(result.totals.missingQuotes).toEqual(["2330"]);
    expect(result.totals.realizedPnl).toBe(9_785);
  });

  it("rejects selling before purchase and duplicate transaction IDs", () => {
    expect(() => calculatePortfolio([trades[2]], {}, { asOfDate: DATE })).toThrow("超過");
    expect(() => calculatePortfolio([trades[0], trades[0]], {}, { asOfDate: DATE })).toThrow("不重複");
  });

  it("consumes all remaining cent cost on the final sale, avoiding residual phantom cost", () => {
    const transactions: Transaction[] = [
      { id: "a", date: DATE, type: "buy", symbol: "0050", kind: "etf", quantity: 3, price: 10, actualCommission: 1 },
      { id: "b", date: DATE, type: "sell", symbol: "0050", kind: "etf", quantity: 1, price: 11, actualCommission: 1, actualTax: 0 },
      { id: "c", date: DATE, type: "sell", symbol: "0050", kind: "etf", quantity: 2, price: 11, actualCommission: 1, actualTax: 0 },
    ];
    expect(calculatePortfolio(transactions, {}, { asOfDate: DATE }).positions[0]).toMatchObject({ quantity: 0, totalCost: 0, averageCost: 0, realizedPnl: 0, totalPnl: 0, marketValue: 0 });
  });

  it("uses the original transaction fee snapshot over subsequently edited defaults", () => {
    const transaction: Transaction = { id: "snapshot", type: "buy", symbol: "2330", kind: "stock", date: DATE, price: 100, quantity: 1_000, feeSettings: { discount: 1 } };
    const result = calculatePortfolio([transaction], {}, { asOfDate: DATE, feeSettings: { discount: 0.1 }, feeRules: [{ id: "rule", label: "dated", effectiveFrom: "2026-01-01", settings: { discount: 0.28 } }] });
    expect(result.totals.totalCost).toBe(100_142);
  });

  it("estimates liquidation with the valuation-date fee rule without rewriting historical costs", () => {
    const transaction: Transaction = {
      id: "historical-fee", type: "buy", symbol: "2330", kind: "stock",
      date: "2026-10-01", price: 100, quantity: 1_000,
      feeSettings: { discount: 1 },
    };
    const result = calculatePortfolio([transaction], { "2330": { price: 100, date: DATE } }, {
      asOfDate: DATE,
      feeSettings: { discount: 0.6 },
      feeRules: [{ id: "current", label: "估值日優惠", effectiveFrom: "2026-10-20", settings: { discount: 0.1 } }],
    });
    // Original buy: floor(100,000 × 0.1425%) = 142. Current sale:
    // discounted fee hits the board-lot NT$20 minimum, tax is NT$300.
    expect(result.positions[0]).toMatchObject({
      totalCost: 100_142,
      marketValue: 100_000,
      netLiquidationValue: 99_680,
      unrealizedPnl: -142,
      unrealizedNetPnl: -462,
    });
    expect(result.totals.commissions).toBe(142);
    const beforeNewRule = calculatePortfolio([transaction], { "2330": { price: 100, date: "2026-10-19" } }, {
      asOfDate: "2026-10-19", feeSettings: { discount: 0.6 },
      feeRules: [{ id: "current", label: "估值日優惠", effectiveFrom: "2026-10-20", settings: { discount: 0.1 } }],
    });
    expect(beforeNewRule.positions[0].netLiquidationValue).toBe(99_615);
    expect(beforeNewRule.positions[0].totalCost).toBe(100_142);
  });

  it("uses the Taiwan calendar date before UTC midnight when no valuation date is supplied", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-27T17:00:00Z"));
      expect(todayTaipei()).toBe("2026-10-28");
      const transaction: Transaction = { id: "today", type: "buy", symbol: "0050", kind: "etf", date: "2026-10-28", quantity: 1, price: 10 };
      expect(calculatePortfolio([transaction]).positions[0].quantity).toBe(1);
      vi.setSystemTime(new Date("2026-12-31T17:00:00Z"));
      expect(todayTaipei()).toBe("2027-01-01");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("cash position risk with costs, gaps and two targets", () => {
  const input = { kind: "stock" as const, entry: 100, stop: 95, target: 115, capital: 100_000, riskPercent: 1, slippageBps: 10, gapPercent: 2, date: DATE };

  it("keeps recommended position within the actual loss and cash budgets", () => {
    const result = calculateRisk(input);
    expect(result.quantity).toBeGreaterThan(0);
    expect(result.lossAtStop).toBeLessThanOrEqual(result.riskBudget);
    expect(result.capitalRequired).toBeLessThanOrEqual(input.capital);
    expect(result.effectiveEntry).toBeGreaterThan(input.entry);
    expect(result.effectiveStop).toBeLessThan(input.stop);
    expect(result.rewardRiskRatio).toBeGreaterThan(0);
    expect(result.breakEvenPrice).toBeGreaterThan(result.effectiveEntry);
  });

  it("evaluates user quantity instead of concealing its risk and calculates a second target", () => {
    const result = calculateRisk({ ...input, userQuantity: 1_001, target2: 125 });
    expect(result.quantity).toBe(1_001);
    expect(result.exceedsRiskBudget).toBe(true);
    expect(result.exceedsCapital).toBe(true);
    expect(result.profitAtTarget2).toBeGreaterThan(result.profitAtTarget);
    expect(result.entryCash).toBe(calculateTradeCosts({ ...defaultTrade, side: "buy", quantity: 1_001, price: result.effectiveEntry }).total);
  });

  it("includes split-order minimums for a mixed position at low prices", () => {
    const result = calculateRisk({ ...input, entry: 1, stop: 0.9, target: 1.2, slippageBps: 0, gapPercent: 0, userQuantity: 1_001 });
    expect(result.entryCash).toBe(1_022);
    expect(result.stopNet).toBe(877.9);
    expect(result.lossAtStop).toBe(144.1);
  });

  it("handles a budget too small for one share and a 100% gap scenario", () => {
    expect(calculateRisk({ ...input, capital: 1 }).quantity).toBe(0);
    const gap = calculateRisk({ ...input, gapPercent: 100 });
    expect(gap.effectiveStop).toBe(0);
    expect(gap.lossAtStop).toBeGreaterThanOrEqual(gap.entryCash);
    expect(gap.lossAtStop).toBeLessThanOrEqual(gap.riskBudget);
  });

  it("evaluates tiny and zero cash risk budgets without rejecting a manual position", () => {
    const tiny = calculateRisk({ ...input, capital: 300_000, riskPercent: 1 / 300_000 * 100, userQuantity: 100 });
    expect(tiny.riskBudget).toBe(1);
    expect(tiny.recommendedQuantity).toBe(0);
    expect(tiny.quantity).toBe(100);
    expect(tiny.exceedsRiskBudget).toBe(true);
    const zero = calculateRisk({ ...input, riskPercent: 0, userQuantity: 100 });
    expect(zero.riskBudget).toBe(0);
    expect(zero.recommendedQuantity).toBe(0);
    expect(zero.quantity).toBe(100);
    expect(zero.exceedsRiskBudget).toBe(true);
    expect(calculateRisk({ ...input, riskPercent: 0 }).quantity).toBe(0);
  });

  it("finds a valid stock tick break-even price whose net covers entry cash", () => {
    const entry = calculateTradeCosts({ ...defaultTrade, side: "buy", price: 49.95, quantity: 999 });
    const breakEven = calculateBreakEvenPrice({ kind: "stock", quantity: 999, entryCash: entry.total, date: DATE });
    expect(calculateTradeCosts({ ...defaultTrade, side: "sell", price: breakEven, quantity: 999 }).total).toBeGreaterThanOrEqual(entry.total);
    expect(Math.round(breakEven * 100) % (breakEven < 50 ? 5 : 10)).toBe(0);
  });

  it("rejects inverted stops, non-finite amounts and invalid target2", () => {
    expect(() => calculateRisk({ ...input, stop: 101 })).toThrow("停損");
    expect(() => calculateRisk({ ...input, target2: 99 })).toThrow("第二目標");
    expect(() => calculateRisk({ ...input, capital: Infinity })).toThrow("資金");
  });
});
