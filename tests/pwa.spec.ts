import { test, expect } from '@playwright/test';

test.describe('PWA 安裝與離線', () => {
  test.use({ serviceWorkers: 'allow' });

  test('首次安裝離線支援不重新整理頁面或中斷使用者操作', async ({ page }) => {
    await page.route('**/api/market**', route => route.fulfill({ json: {
      quotes: [], index: null, fetchedAt: '2026-10-28T00:00:00Z',
      cached: false, errors: ['首次安裝測試無市場資料'],
    } }));
    let documentRequests = 0;
    // Next initializes its history state using same-document replaceState, which
    // Playwright also reports as framenavigated. Count actual document loads.
    page.on('request', request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++;
    });
    await page.addInitScript(() => {
      const key = 'pwa-audit-document-loads';
      sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? '0') + 1));
    });
    await page.goto('/');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect(page.getByRole('navigation')).toBeVisible();
    expect(documentRequests).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem('pwa-audit-document-loads'))).toBe('1');
  });

  test('manifest、獨立模式與圖示可供瀏覽器安裝', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toContain('StockPilot');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '192x192')).toBeTruthy();
    expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512')).toBeTruthy();
    for (const icon of manifest.icons) {
      const result = await request.get(icon.src);
      expect(result.ok()).toBeTruthy();
      expect(result.headers()['content-type']).toContain('image/png');
    }
    const sw = await request.get('/sw.js');
    expect(sw.ok()).toBeTruthy();
    expect(sw.headers()['cache-control']).toContain('no-cache');
  });

  test('離線重新開啟可用介面，市場 API 不被 service worker 偽裝成功', async ({ page, context }) => {
    await page.route('**/api/market**', route => route.fulfill({ json: {
      quotes: [], index: null, fetchedAt: '2026-10-28T00:00:00Z',
      cached: false, errors: ['離線測試前無市場資料'],
    } }));
    await page.goto('/');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const cacheKeys = await page.evaluate(async () => {
      const keys = await caches.keys();
      const requests = await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(item => item.url)));
      return requests.flat();
    });
    expect(cacheKeys.some(url => url.includes('/api/'))).toBeFalsy();
    await page.unroute('**/api/market**');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/離線模式/).first()).toBeVisible();
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: '持倉', exact: true }).click();
    await expect(page.locator('main')).toBeVisible();
  });
});
