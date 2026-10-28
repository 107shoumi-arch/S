import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Synthetic prices are isolated to browser tests, never shipped by the market adapter.
const quote = {
  symbol: '2330', name: '台灣積體電路製造股份有限公司測試用超長名稱',
  price: 100, change: -2, changePercent: -1.960784, volume: 12345678,
  asOf: '2026-10-27T13:30:00+08:00', source: '自動測試合成資料（非市場行情）',
  market: 'TWSE', kind: 'stock', delayed: true,
};
const etf = { ...quote, symbol: '0050', name: '元大台灣50', price: 50, change: 0, changePercent: 0, kind: 'etf' };
const candles = Array.from({ length: 40 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 7, i + 1)).toISOString().slice(0, 10),
  open: 90 + i / 4, high: 94 + i / 4, low: 88 + i / 4, close: 92 + i / 4, volume: 1000000 + i * 10000,
}));

async function mockMarket(page: Page, mode: 'success' | 'error' = 'success') {
  await page.route('**/api/market**', async route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    const quotes = [quote, etf].filter(item => !query || item.symbol.includes(query) || item.name.includes(query));
    await route.fulfill({ json: {
      quotes: mode === 'success' ? quotes : [], index: mode === 'success' ? {
        name: '加權指數（測試）', value: 22000.15, change: -100.2,
        asOf: quote.asOf, source: quote.source,
      } : null,
      fetchedAt: '2026-10-28T01:00:00Z', cached: false,
      errors: mode === 'error' ? ['官方資料暫時無法連線（自動測試）'] : [],
    } });
  });
  await page.route('**/api/history**', route => route.fulfill({ json: {
    candles: mode === 'success' ? candles : [], source: quote.source,
    asOf: quote.asOf, errors: mode === 'success' ? [] : ['歷史資料暫時無法取得'],
  } }));
}

async function assertNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  const overflows = await page.locator('main').evaluate(el => [...el.querySelectorAll<HTMLElement>('input,button,h1,h2,h3,p,.money,.stat-value')]
    .filter(node => getComputedStyle(node).opacity !== '0' && node.getBoundingClientRect().width > 0 && node.scrollWidth > node.clientWidth + 2)
    .map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 80), width: node.clientWidth, scroll: node.scrollWidth })));
  expect(overflows).toEqual([]);
}

async function tab(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('main')).toBeVisible();
}

for (const width of [375, 390, 393, 430, 440]) {
  test(`${width}px 五個主要頁面、導覽與行情卡片不溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 932 });
    await mockMarket(page);
    await page.goto('/');
    await expect(page.getByText('StockPilot', { exact: false }).first()).toBeVisible();
    for (const name of ['總覽', '自選', '分析', '持倉', '設定']) {
      await tab(page, name);
      await assertNoOverflow(page);
      const navButtons = page.getByRole('navigation').getByRole('button');
      await expect(navButtons).toHaveCount(5);
      for (const button of await navButtons.all()) {
        const bounds = await button.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      const smallTargets = await page.locator('main button, header button').evaluateAll(buttons => buttons
        .map(button => ({ label: button.getAttribute('aria-label') || button.textContent?.trim(), box: button.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0 && (box.width < 43.9 || box.height < 43.9))
        .map(({ label, box }) => ({ label, width: box.width, height: box.height })));
      expect(smallTargets).toEqual([]);
    }
  });
}

test('行情來源失敗有明確錯誤，所有頁面仍可使用', async ({ page }) => {
  await mockMarket(page, 'error');
  await page.goto('/');
  await page.locator('.data-notice summary').click();
  await expect(page.getByText(/官方資料暫時無法連線/).first()).toBeVisible();
  await assertNoOverflow(page);
  await tab(page, '持倉');
  await expect(page.getByRole('main')).toBeVisible();
  await tab(page, '分析');
  await expect(page.getByRole('main')).toBeVisible();
  await assertNoOverflow(page);
});

test('支援橫向與高系統字級，並保留使用者縮放', async ({ page }) => {
  await mockMarket(page);
  await page.goto('/');
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).toContain('viewport-fit=cover');
  expect(viewport).not.toMatch(/user-scalable=no|maximum-scale=1/);
  await page.setViewportSize({ width: 932, height: 430 });
  await assertNoOverflow(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addStyleTag({ content: 'html { font-size: 22px !important; } body { -webkit-text-size-adjust: 140% !important; }' });
  for (const name of ['總覽', '自選', '分析', '持倉', '設定']) {
    await tab(page, name);
    await assertNoOverflow(page);
  }
});

test('超大部位、負損益及長名稱在全部手機寬度仍可讀取', async ({ page }) => {
  await mockMarket(page);
  await page.addInitScript(() => localStorage.setItem('stockpilot-tw-v1', JSON.stringify({
    version: 1, theme: 'light', accent: '#27766d', watchlist: ['2330'], manualQuotes: {},
    transactions: [{ id: 'extreme-test', symbol: '2330', kind: 'stock', type: 'buy', date: '2026-10-01', quantity: 1000000, price: 1000000 }],
    fees: { commissionRate: 0.001425, discount: 0.6, boardLotMinimum: 20, oddLotMinimum: 1, rounding: 'floor' },
  })));
  await page.goto('/');
  for (const width of [375, 390, 393, 430, 440]) {
    await page.setViewportSize({ width, height: 932 });
    for (const name of ['總覽', '持倉', '自選', '分析']) {
      await tab(page, name);
      await assertNoOverflow(page);
      const numbers = await page.locator('.hero-amount,.large-number,.hero-performance,.position-heading b,.metric-grid b').evaluateAll(nodes => nodes
        .filter(node => node.scrollWidth > node.clientWidth + 2)
        .map(node => node.textContent));
      expect(numbers).toEqual([]);
    }
  }
  await tab(page, '持倉');
  await expect(page.locator('.large-number')).toContainText('−');
});

test('手動日期行情、加碼減碼、股利、即時計算及重新開啟保留資料', async ({ page }) => {
  await mockMarket(page, 'error');
  await page.goto('/');
  await tab(page, '自選');
  await page.getByRole('button', { name: '手動價格', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: '股票代號', exact: true }).fill('2330');
  await dialog.getByRole('textbox', { name: '股票名稱', exact: true }).fill('個人手動輸入測試標的');
  await dialog.getByLabel('手動報價', { exact: true }).fill('105');
  await dialog.getByLabel('報價日期', { exact: true }).fill('2026-10-27');
  await dialog.getByRole('button', { name: '儲存手動價格' }).click();
  await expect(dialog).not.toBeVisible();
  await tab(page, '持倉');
  await page.getByRole('button', { name: '新增交易', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('交易日期', { exact: true }).fill('2026-10-20');
  await dialog.getByLabel('買入或賣出價格', { exact: true }).fill('100');
  await dialog.getByLabel('買入或賣出股數', { exact: true }).fill('1000');
  await expect(dialog.getByLabel('買入或賣出價格', { exact: true })).toHaveAttribute('inputmode', 'decimal');
  await expect(dialog.getByLabel('買入或賣出股數', { exact: true })).toHaveAttribute('inputmode', 'numeric');
  await dialog.getByRole('button', { name: '儲存交易', exact: true }).click();
  const position = page.locator('.position').filter({ hasText: '2330' });
  await expect(position).toContainText('1,000 股');
  await expect(position).toContainText('100.085');
  await expect(position).toContainText('手動輸入');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '持倉成本（含費）' }).locator('b')).toHaveText('100,085');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '持倉市值' }).locator('b')).toHaveText('105,000');
  await position.getByRole('button', { name: '減碼', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('交易日期', { exact: true }).fill('2026-10-21');
  await dialog.getByLabel('買入或賣出價格', { exact: true }).fill('110');
  await dialog.getByLabel('買入或賣出股數', { exact: true }).fill('100');
  await dialog.getByRole('button', { name: '儲存交易', exact: true }).click();
  await expect(position).toContainText('900 股');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '已實現損益' }).locator('b')).toHaveText('+949.5');
  await position.getByRole('button', { name: '記錄股利', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('交易日期', { exact: true }).fill('2026-10-22');
  await dialog.getByLabel('現金股利', { exact: true }).fill('500');
  await dialog.getByRole('button', { name: '儲存交易', exact: true }).click();
  await expect(page.locator('.metric-grid > div').filter({ hasText: '淨股利收入' }).locator('b')).toHaveText('500');
  await page.getByRole('button', { name: '更新手動價格', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('手動報價', { exact: true }).fill('90');
  await dialog.getByRole('button', { name: '儲存手動價格' }).click();
  await expect(page.locator('.metric-grid > div').filter({ hasText: '持倉市值' }).locator('b')).toHaveText('81,000');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '未實現損益' }).locator('b')).toHaveText('−9,076.5');
  await assertNoOverflow(page);
  await page.reload();
  await tab(page, '持倉');
  await expect(page.locator('.transaction-row')).toHaveCount(3);
  await expect(position).toContainText('900 股');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '持倉市值' }).locator('b')).toHaveText('81,000');
  await tab(page, '設定');
  await page.getByLabel('手續費折扣', { exact: true }).fill('1');
  await tab(page, '持倉');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '持倉成本（含費）' }).locator('b')).toHaveText('90,076.5');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '已實現損益' }).locator('b')).toHaveText('+949.5');
  // An oversell must show a useful error and preserve the existing ledger.
  await position.getByRole('button', { name: '減碼', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('買入或賣出股數', { exact: true }).fill('901');
  await dialog.getByRole('button', { name: '儲存交易', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('損毀的本機資料不被預設值覆寫，可透過有效備份復原費率快照', async ({ page }) => {
  await mockMarket(page);
  const corrupt = '{"version":1,"transactions":[';
  await page.addInitScript(raw => localStorage.setItem('stockpilot-tw-v1', raw), corrupt);
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('目前未覆寫舊資料');
  await tab(page, '設定');
  await page.getByLabel('顯示模式', { exact: true }).selectOption('dark');
  expect(await page.evaluate(() => localStorage.getItem('stockpilot-tw-v1'))).toBe(corrupt);
  const fees = { commissionRate: 0.001425, discount: 1, boardLotMinimum: 20, oddLotMinimum: 1, rounding: 'floor' };
  const data = {
    version: 1, theme: 'light', accent: '#27766d', watchlist: ['2330'], manualQuotes: {}, fees,
    transactions: [{ id: 'restored', symbol: '2330', kind: 'stock', type: 'buy', date: '2026-10-20',
      quantity: 1000, price: 100, feeSettings: { ...fees, discount: 0.6 } }],
  };
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('匯入投資資料備份', { exact: true }).setInputFiles({
    name: 'recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByRole('status')).toContainText('備份已匯入');
  await tab(page, '持倉');
  await expect(page.locator('.metric-grid > div').filter({ hasText: '持倉成本（含費）' }).locator('b')).toHaveText('100,085');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('stockpilot-tw-v1')!).transactions.length)).toBe(1);
});

test('行情 CSV 可匯入實際輸入值，負價格檔案被拒絕且保留已有資料', async ({ page }) => {
  await mockMarket(page, 'error');
  await page.goto('/');
  await tab(page, '設定');
  const csv = 'symbol,name,price,asOf,market,kind\n00679B,使用者匯入資料測試,17.55,2026-10-27,TWSE,bond-etf';
  await page.getByLabel('匯入行情 CSV', { exact: true }).setInputFiles({
    name: 'quotes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(page.getByRole('status')).toContainText('已匯入 1 筆');
  await page.getByLabel('匯入行情 CSV', { exact: true }).setInputFiles({
    name: 'bad-quotes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.replace('17.55', '-1')),
  });
  await expect(page.getByRole('status')).toContainText('價格須介於 0.01 與 100,000,000');
  await tab(page, '自選');
  await page.getByRole('textbox', { name: '搜尋股票代號或中文名稱' }).fill('00679B');
  await expect(page.locator('.quote-row').first()).toContainText('17.55');
  await page.locator('.quote-row .quote-main').first().click();
  await expect(page.locator('.data-provenance')).toContainText('使用者匯入');
});

test('搜尋、K 線容器縮放、週月切換及風險試算會隨精確數值立即更新', async ({ page }) => {
  await mockMarket(page);
  await page.goto('/');
  await tab(page, '自選');
  const search = page.getByRole('textbox', { name: '搜尋股票代號或中文名稱' });
  await search.fill('台灣積體');
  const searchCard = page.locator('.content-grid > section').first();
  await expect(searchCard.locator('.quote-row')).toHaveCount(1);
  await searchCard.locator('.quote-row .quote-main').click();
  const chart = page.getByRole('img', { name: /日 K 線圖/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator('canvas').first()).toBeVisible();
  for (const width of [375, 390, 393, 430, 440]) {
    await page.setViewportSize({ width, height: 932 });
    await expect.poll(async () => (await chart.boundingBox())?.width || 0).toBeLessThan(width);
    await assertNoOverflow(page);
  }
  await page.getByRole('button', { name: '週 K', exact: true }).click();
  await expect(page.getByRole('img', { name: /週 K 線圖/ })).toBeVisible();
  await page.getByRole('button', { name: '月 K', exact: true }).click();
  await expect(page.getByRole('img', { name: /月 K 線圖/ })).toBeVisible();
  await expect(page.locator('.risk-primary strong')).toBeVisible();
  const initialLoss = await page.locator('.risk-primary strong').textContent();
  await page.getByLabel('持有股數', { exact: true }).fill('100');
  await expect(page.locator('.risk-primary strong')).not.toHaveText(initialLoss || '');
  await page.getByLabel('最大可承受損失', { exact: true }).fill('1');
  await expect(page.getByText('超過單筆風險上限，請減少股數或調整條件。')).toBeVisible();
  await page.getByLabel('停損價格', { exact: true }).fill('101');
  await expect(page.getByRole('heading', { name: '請確認試算條件' })).toBeVisible();
});

test('深淺與自訂主題、備份下載及拒絕無效匯入', async ({ page }) => {
  await mockMarket(page);
  await page.goto('/');
  await tab(page, '設定');
  await page.getByLabel('顯示模式', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await assertNoOverflow(page);
  await page.getByLabel('顯示模式', { exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('自訂主題色', { exact: true }).fill('#5f468b');
  await expect.poll(() => page.locator('html').evaluate(el => el.style.getPropertyValue('--accent'))).toBe('#5f468b');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出備份', exact: true }).click();
  const backup = await download;
  expect(backup.suggestedFilename()).toMatch(/^StockPilot-TW-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = await readFile((await backup.path())!, 'utf8');
  expect(JSON.parse(exported)).toMatchObject({ version: 1, accent: '#5f468b', theme: 'light', transactions: [] });
  await page.getByLabel('匯入投資資料備份', { exact: true }).setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}'),
  });
  await expect(page.getByRole('status')).toContainText('不支援的備份版本');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('顯示模式', { exact: true }).selectOption('dark');
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('匯入投資資料備份', { exact: true }).setInputFiles({
    name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(exported),
  });
  await expect(page.getByRole('status')).toContainText('備份已匯入');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await tab(page, '設定');
  await expect(page.getByLabel('顯示模式', { exact: true })).toHaveValue('light');
  await expect(page.getByLabel('自訂主題色', { exact: true })).toHaveValue('#5f468b');
});

test('行情更新保留捲動位置、可讀載入狀態與最後一筆內容不被導覽遮擋', async ({ page }) => {
  await mockMarket(page);
  await page.goto('/');
  await tab(page, '自選');
  await expect(page.locator('.quote-row').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 180));
  const before = await page.evaluate(() => window.scrollY);
  // Programmatic click isolates refresh behavior from Playwright scrolling the top button into view.
  await page.getByRole('button', { name: '更新行情', exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.getByRole('button', { name: '更新行情', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const lastContent = await page.locator('main .card').last().boundingBox();
  const bottomNav = await page.getByRole('navigation').boundingBox();
  expect(lastContent!.y + lastContent!.height).toBeLessThanOrEqual(bottomNav!.y + 1);
});

test('430 × 932 iPhone 規格畫面截圖（合成測試資料明確標示）', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await mockMarket(page);
  await page.goto('/');
  await expect(page.locator('.market-number').first()).toContainText('22,000');
  await page.screenshot({ path: 'screenshots/iphone-430-overview.png', fullPage: true });
  await tab(page, '分析');
  await expect(page.getByRole('img', { name: /日 K 線圖/ })).toBeVisible();
  await page.screenshot({ path: 'screenshots/iphone-430-analysis.png', fullPage: true });
  await page.getByRole('button', { name: '切換深淺色模式', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'screenshots/iphone-430-dark.png', fullPage: true });
});

test('430 × 932 實際服務啟動畫面截圖，不攔截市場資料', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '更新行情', exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.screenshot({ path: 'screenshots/iphone-430-actual.png' });
});
