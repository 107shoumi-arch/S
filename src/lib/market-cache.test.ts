import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('undici', () => ({ fetch: request, ProxyAgent: class {} }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn().mockRejectedValue(new Error('no cache')), mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined) }));

describe('official adapter recovery — mocked transport only', () => {
  beforeEach(() => {
    vi.resetModules();
    request.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T06:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('retries a totally empty failed snapshot after 30 seconds', async () => {
    request.mockRejectedValue(new Error('test network unavailable'));
    const { getMarket } = await import('./market');
    expect((await getMarket()).quotes).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(20_000);
    await getMarket();
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(11_000);
    const result = await getMarket();
    expect(request).toHaveBeenCalledTimes(6);
    expect(result.quotes).toEqual([]);
    expect(result.index).toBeNull();
    expect(result.cached).toBe(false);
  });

  it('retains the 15-minute cadence for partial success with usable quotes', async () => {
    request.mockImplementation(async (url: string) => {
      if (!url.includes('STOCK_DAY_ALL')) throw new Error('test source unavailable');
      return { ok: true, text: async () => JSON.stringify([{ Date: '1151028', Code: '2330', Name: '測試資料', ClosingPrice: '100' }]) };
    });
    const { getMarket } = await import('./market');
    const first = await getMarket();
    expect(first.quotes).toHaveLength(1);
    expect(first.errors.length).toBeGreaterThan(0);
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(31_000);
    await getMarket();
    expect(request).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15 * 60_000);
    await getMarket();
    expect(request).toHaveBeenCalledTimes(6);
  });
});
