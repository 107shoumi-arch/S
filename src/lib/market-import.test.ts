import { describe, expect, it, vi } from 'vitest';
import { parseQuoteCsv } from './market-import';

const header = 'symbol,name,price,asOf,market,kind,change,volume\n';

describe('quote CSV import — synthetic test fixtures only', () => {
  it('preserves explicit provenance, timestamp, signs and quoted thousands', () => {
    const [q] = parseQuoteCsv(header + '2330,"測試,公司","1,000.5",2025-01-02,TWSE,stock,-5,"1,250"');
    expect(q.price).toBe(1000.5);
    expect(q.name).toBe('測試,公司');
    expect(q.change).toBe(-5);
    expect(q.volume).toBe(1250);
    expect(q.source).toBe('使用者匯入（未經官方驗證）');
    expect(q.delayed).toBe(true);
    expect(q.asOf).toBe('2025-01-02');
  });
  it('rejects missing trade dates and invalid or future prices', () => {
    expect(() => parseQuoteCsv(header + '2330,測試,100,,TWSE,stock,,')).toThrow('asOf');
    expect(() => parseQuoteCsv(header + '2330,測試,NaN,2025-01-02,TWSE,stock,,')).toThrow('價格');
    expect(() => parseQuoteCsv(header + '2330,測試,-1,2025-01-02,TWSE,stock,,')).toThrow('價格');
    expect(() => parseQuoteCsv(header + '2330,測試,100,2099-01-01,TWSE,stock,,')).toThrow('未來');
    expect(() => parseQuoteCsv(header + '2330,測試,100,2025-02-30,TWSE,stock,,')).toThrow('日期不存在');
  });
  it('accepts today in Taiwan before UTC midnight but rejects tomorrow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T16:30:00Z'));
    try {
      expect(parseQuoteCsv(header + '2330,測試,100,2026-10-29,TWSE,stock,,')[0].asOf).toBe('2026-10-29');
      expect(() => parseQuoteCsv(header + '2330,測試,100,2026-10-30,TWSE,stock,,')).toThrow('未來');
      expect(() => parseQuoteCsv(header + '2330,測試,100,2026-10-29T01:00:00+08:00,TWSE,stock,,')).toThrow('未來');
    } finally { vi.useRealTimers(); }
  });
  it('requires market, instrument class, unique symbols and whole-share volume', () => {
    expect(() => parseQuoteCsv(header + '2330,測試,100,2025-01-02,OTHER,stock,,')).toThrow('market');
    expect(() => parseQuoteCsv(header + '2330,測試,100,2025-01-02,TWSE,fund,,')).toThrow('kind');
    expect(() => parseQuoteCsv(header + '2330,測試,100,2025-01-02,TWSE,stock,,1.2')).toThrow('成交股數');
    expect(() => parseQuoteCsv(header + '2330,測試,100,2025-01-02,TWSE,stock,,\n2330,測試,100,2025-01-02,TWSE,stock,,')).toThrow('重複');
  });
  it('enforces the finance valuation price range and cent precision', () => {
    for (const price of ['100.1234', '100000000.01', '0.001']) {
      expect(() => parseQuoteCsv(header + `2330,測試,${price},2025-01-02,TWSE,stock,,`)).toThrow('價格');
    }
    expect(parseQuoteCsv(header + '2330,測試,100000000,2025-01-02,TWSE,stock,,')[0].price).toBe(100_000_000);
    expect(parseQuoteCsv(header + '2330,測試,0.01,2025-01-02,TWSE,stock,,')[0].price).toBe(0.01);
  });
  it('supports UTF-8 BOM, CRLF, ETF codes and escaped quotes', () => {
    const [q] = parseQuoteCsv('\uFEFF' + header.replaceAll('\n', '\r\n') + '00679B,"測試""債",30,2025-01-02,TPEx,bond-etf,,0\r\n');
    expect(q.symbol).toBe('00679B');
    expect(q.name).toBe('測試"債');
    expect(q.volume).toBe(0);
  });
  it('rejects malformed row structure rather than silently corrupting values', () => {
    expect(() => parseQuoteCsv(header + '2330,"未完成')).toThrow('引號');
    expect(() => parseQuoteCsv(header + '2330,公司,100')).toThrow('欄位數量');
  });
});
