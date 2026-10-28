import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { numberValue, officialDate, parseOfficialIndex, parseOfficialQuotes, parseTwseHistory, taipeiCalendar } from './market';

describe('official data parsers — synthetic fixtures, never runtime quotations', () => {
  it('normalizes Gregorian and ROC dates and rejects impossible dates', () => {
    expect(officialDate('115/10/28')).toBe('2026-10-28');
    expect(officialDate('1151028')).toBe('2026-10-28');
    expect(officialDate('20261028')).toBe('2026-10-28');
    expect(officialDate('2026-10-28')).toBe('2026-10-28');
    expect(officialDate('115/02/30')).toBeNull();
    expect(officialDate('')).toBeNull();
  });
  it('preserves negative changes and refuses placeholders', () => {
    expect(numberValue('-1,234.50')).toBe(-1234.5);
    expect(numberValue('--')).toBeNull();
    expect(numberValue('')).toBeNull();
  });
  it('parses listed closing quotes without claiming real-time data', () => {
    const [q] = parseOfficialQuotes([{ Date: '1151028', Code: '2330', Name: '測試', ClosingPrice: '100', Change: '-5', TradeVolume: '1,000' }], 'TWSE');
    expect(q.price).toBe(100);
    expect(q.changePercent).toBeCloseTo(-5 / 105 * 100);
    expect(q.volume).toBe(1000);
    expect(q.asOf).toBe('2026-10-28');
    expect(q.delayed).toBe(true);
    expect(q.source).toContain('每日收盤');
  });
  it('parses OTC fields and bond ETF classification hint', () => {
    const [q] = parseOfficialQuotes([{ Date: '115/10/28', SecuritiesCompanyCode: '00679B', CompanyName: '測試債', Close: '31.2', Change: '0.2', TradingShares: '200' }], 'TPEx');
    expect(q.market).toBe('TPEx');
    expect(q.kind).toBe('bond-etf');
  });
  it('does not invent missing timestamps, zero closes, or warrant support', () => {
    expect(() => parseOfficialQuotes([{ Code: '2330', Name: '測試', ClosingPrice: '100' }], 'TWSE')).toThrow('日期');
    expect(() => parseOfficialQuotes([{ Date: '1151028', Code: '2330', Name: '測試', ClosingPrice: '--' }], 'TWSE')).toThrow();
    expect(() => parseOfficialQuotes([{ Date: '1151028', Code: '123456', Name: '測試權證', ClosingPrice: '1' }], 'TWSE')).toThrow();
  });
  it('rejects official prices outside the finance contract', () => {
    for (const price of ['100.1234', '100000000.01', '0.001']) {
      expect(() => parseOfficialQuotes([{ Date: '1151028', Code: '2330', Name: '測試', ClosingPrice: price }], 'TWSE')).toThrow();
    }
  });
  it('selects the latest official index by trade date', () => {
    const index = parseOfficialIndex([{ Date: '1151027', TAIEX: '20000', Change: '10' }, { Date: '1151028', TAIEX: '20100', Change: '100' }]);
    expect(index?.asOf).toBe('2026-10-28');
    expect(index?.value).toBe(20100);
  });
  it('parses daily OHLCV and skips no-trade placeholder rows', () => {
    const candles = parseTwseHistory({ data: [['115/10/28', '1,000', '100000', '100', '110', '90', '105'], ['115/10/29', '0', '0', '--', '--', '--', '--']] });
    expect(candles).toEqual([{ time: '2026-10-28', open: 100, high: 110, low: 90, close: 105, volume: 1000 }]);
  });
  it('uses the Taiwan calendar at UTC month boundaries', () => {
    expect(taipeiCalendar(new Date('2026-10-31T16:01:00Z'))).toEqual({ year: 2026, month: 11, today: '2026-11-01' });
    expect(taipeiCalendar(new Date('2026-12-31T16:01:00Z'))).toEqual({ year: 2027, month: 1, today: '2027-01-01' });
  });
  it('rejects inconsistent OHLC, invalid volume, and future historical candles', () => {
    const rows = [
      ['115/10/27', '100', '', '100', '99', '90', '105'],
      ['115/10/27', '100', '', '100', '110', '101', '105'],
      ['115/10/27', '-1', '', '100', '110', '90', '105'],
      ['115/10/27', '1.5', '', '100', '110', '90', '105'],
      ['2099/01/01', '100', '', '100', '110', '90', '105'],
    ];
    expect(parseTwseHistory({ data: rows })).toEqual([]);
  });
});
