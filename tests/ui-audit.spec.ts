import { test, expect, type Page } from '@playwright/test';

// These controlled, synthetic values are used only by this audit. They are not
// market data, user holdings, or application defaults.
const quotes = [{
  symbol: '2330', name: '排版驗收合成標的・長名稱測試股份有限公司',
  price: 100, change: -2, changePercent: -1.96, volume: 123456,
  asOf: '2026-10-27', source: 'UI 驗收合成資料（非市場行情）',
  market: 'TWSE', kind: 'stock', delayed: true,
}, {
  symbol: '0050', name: '排版驗收合成 ETF', price: 50, change: 1,
  changePercent: 2.04, volume: 1000, asOf: '2026-10-27',
  source: 'UI 驗收合成資料（非市場行情）', market: 'TWSE', kind: 'etf', delayed: true,
}];
const candles = Array.from({ length: 35 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10),
  open: 100 + i, high: 104 + i, low: 98 + i, close: 102 + i, volume: 10000,
}));
const tabs = [
  ['總覽', 'overview'], ['自選', 'watchlist'], ['分析', 'analysis'],
  ['持倉', 'portfolio'], ['設定', 'settings'],
] as const;

async function prepare(page: Page, theme = 'light') {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.addInitScript(({ theme }) => localStorage.setItem('stockpilot-tw-v1', JSON.stringify({
    version: 1, theme, accent: '#27766d', watchlist: ['2330', '0050'], manualQuotes: {},
    transactions: [{ id: 'audit-fictional-trade', type: 'buy', symbol: '2330', kind: 'stock',
      date: '2026-10-01', price: 110, quantity: 1000,
      feeSettings: { commissionRate: 0.001425, discount: .6, boardLotMinimum: 20, oddLotMinimum: 1, rounding: 'floor' } }],
    fees: { commissionRate: 0.001425, discount: .6, boardLotMinimum: 20, oddLotMinimum: 1, rounding: 'floor' },
  })), { theme });
  await page.route('**/api/market**', route => route.fulfill({ json: {
    quotes, index: { name: '合成驗收指數', value: 22000, change: -20,
      asOf: '2026-10-27', source: 'UI 驗收合成資料（非市場行情）' },
    errors: [], cached: false, fetchedAt: '2026-10-28T00:00:00Z',
  } }));
  await page.route('**/api/history**', route => route.fulfill({ json: {
    candles, source: 'UI 驗收合成資料（非市場行情）', asOf: '2026-10-05', errors: [],
  } }));
  await page.goto('/');
  await expect(page.locator('.market-number').first()).toHaveText('22,000.00');
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function layoutCheck(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  const overflow = await page.locator('main').evaluate(el => [...el.querySelectorAll<HTMLElement>('.card,.large-number,.hero-amount,.risk-results,.chart,.position-metrics b')]
    .filter(node => node.getBoundingClientRect().width > 0 && node.scrollWidth > node.clientWidth + 2)
    .map(node => ({ tag: node.className, text: node.textContent?.slice(0, 60) })));
  expect(overflow).toEqual([]);
  const tiny = await page.locator('button,a,.file-label,summary,.checkbox-field').evaluateAll(nodes => nodes
    .filter(node => node.getBoundingClientRect().width > 0 && getComputedStyle(node).visibility !== 'hidden')
    .map(node => ({ label: node.getAttribute('aria-label') || node.textContent?.trim(), rect: node.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width < 43.9 || rect.height < 43.9)
    .map(({ label, rect }) => ({ label, width: rect.width, height: rect.height })));
  expect(tiny).toEqual([]);
}

for (const theme of ['light', 'dark']) {
  test(`430×932 ${theme} 五頁完整畫面與所有操作區域`, async ({ page }) => {
    await prepare(page, theme);
    for (const [label, slug] of tabs) {
      await navigate(page, label);
      if (label === '分析') await expect(page.locator('.chart canvas').first()).toBeVisible();
      await layoutCheck(page);
      await page.screenshot({ path: `screenshots/audit-430-${slug}-${theme}-full.png`, fullPage: true });
      await page.screenshot({ path: `screenshots/audit-430-${slug}-${theme}.png` });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const content = await page.locator('main .card').last().boundingBox();
      const nav = await page.getByRole('navigation').boundingBox();
      expect(content!.y + content!.height).toBeLessThanOrEqual(nav!.y + 1);
    }
  });
}

test('交易對話框可縮至鍵盤高度、操作末端輸入與焦點循環', async ({ page }) => {
  await prepare(page);
  await navigate(page, '持倉');
  const opener = page.getByRole('button', { name: '新增交易', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '關閉對話框' })).toBeFocused();
  // A reduced visual viewport is a regression check, not a native iOS keyboard.
  await page.setViewportSize({ width: 430, height: 500 });
  const discount = dialog.getByLabel('本次手續費折扣', { exact: true });
  await discount.focus();
  await discount.fill('0.5');
  const box = await discount.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(500);
  const checkbox = dialog.locator('.checkbox-field');
  const checkboxBox = await checkbox.boundingBox();
  expect(checkboxBox!.height).toBeGreaterThanOrEqual(44);
  await dialog.getByRole('button', { name: '儲存交易', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '關閉對話框' })).toBeFocused();
  await page.screenshot({ path: 'screenshots/audit-430-keyboard-viewport.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('自選、帶入及套用試算、刪除取消與確認都有真實效果', async ({ page }) => {
  await prepare(page);
  await navigate(page, '自選');
  const searchPanel = page.locator('main .card').first();
  await searchPanel.getByRole('button', { name: '移除自選 0050', exact: true }).click();
  await expect(searchPanel.getByRole('button', { name: '加入自選 0050', exact: true })).toBeVisible();
  await searchPanel.getByRole('button', { name: '加入自選 0050', exact: true }).click();
  await searchPanel.locator('.quote-row').filter({ hasText: '2330' }).locator('.quote-main').click();
  await page.getByRole('button', { name: '帶入試算', exact: true }).click();
  await expect(page.getByLabel('進場價格', { exact: true })).toHaveValue('100');
  await page.getByLabel('最大可承受損失', { exact: true }).fill('1000');
  await page.getByRole('button', { name: '套用可承受股數', exact: true }).click();
  expect(Number(await page.getByLabel('持有股數', { exact: true }).inputValue())).toBeLessThan(1000);
  await navigate(page, '持倉');
  const remove = page.getByRole('button', { name: '刪除 2026-10-01 2330 交易', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await remove.click();
  await expect(page.locator('.transaction-row')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await remove.click();
  await expect(page.locator('.transaction-row')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '從第一筆投資開始' })).toBeVisible();
});

test('行情慢速更新時保留數值卡片與圖表，且不改變捲動位置', async ({ page }) => {
  await prepare(page);
  await navigate(page, '分析');
  await expect(page.locator('.chart canvas').first()).toBeVisible();
  await page.evaluate(() => { window.scrollTo(0, 280); });
  const top = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => { (window as unknown as { auditChart?: Element | null }).auditChart = document.querySelector('.chart canvas'); });
  await page.unroute('**/api/market**');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/market**', async route => {
    await gate;
    await route.fulfill({ json: { quotes: quotes.map(q => ({ ...q, price: q.price + 1 })),
      index: null, errors: [], cached: false, fetchedAt: '2026-10-28T01:00:00Z' } });
  });
  await page.getByRole('button', { name: '更新行情' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('button', { name: '更新行情' })).toBeDisabled();
  await expect(page.locator('.quote-detail strong')).toHaveText('100.00');
  expect(await page.evaluate(() => window.scrollY)).toBe(top);
  release();
  await expect(page.getByRole('button', { name: '更新行情' })).toBeEnabled();
  await expect(page.locator('.quote-detail strong')).toHaveText('101.00');
  expect(await page.evaluate(() => window.scrollY)).toBe(top);
  expect(await page.evaluate(() => (window as unknown as { auditChart?: Element }).auditChart === document.querySelector('.chart canvas'))).toBe(true);
});

test('保留舊行情時清楚標為快取，手動無效價格錯誤出現在對話框內', async ({ page }) => {
  await prepare(page);
  await navigate(page, '分析');
  await expect(page.locator('.quote-detail strong')).toHaveText('100.00');
  await page.unroute('**/api/market**');
  await page.route('**/api/market**', route => route.fulfill({ json: {
    quotes: [], index: null, cached: false, errors: ['驗收來源暫時失敗'], fetchedAt: '2026-10-28T01:00:00Z',
  } }));
  await page.getByRole('button', { name: '更新行情' }).click();
  await expect(page.getByRole('button', { name: '更新行情' })).toBeEnabled();
  await expect(page.locator('.quote-detail strong')).toHaveText('100.00');
  await expect(page.locator('.data-provenance')).toContainText('快取');
  await expect(page.locator('.data-provenance')).toContainText('2026-10-27');
  await navigate(page, '自選');
  await page.getByRole('button', { name: '手動價格', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // Exercise application validation as well as the input's native max rule.
  await dialog.locator('form').evaluate((form: HTMLFormElement) => { form.noValidate = true; });
  await dialog.getByLabel('手動報價', { exact: true }).fill('100000000.01');
  await dialog.getByRole('button', { name: '儲存手動價格' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
});

test('極端自訂白色或黑色在深淺模式仍保有可讀對比', async ({ page }) => {
  await prepare(page);
  await navigate(page, '設定');
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('顯示模式', { exact: true }).selectOption(theme);
    for (const accent of ['#ffffff', '#000000']) {
      await page.getByLabel('自訂主題色', { exact: true }).fill(accent);
      const ratios = await page.evaluate(() => {
        const rgb = (value: string) => {
          const trimmed = value.trim();
          if (!trimmed.startsWith('#')) return (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const hex = trimmed.length === 4 ? `#${[...trimmed.slice(1)].map(c => c + c).join('')}` : trimmed;
          return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
        };
        const lum = (values: number[]) => values.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const contrast = (a: string, b: string) => (Math.max(lum(rgb(a)), lum(rgb(b))) + .05) / (Math.min(lum(rgb(a)), lum(rgb(b))) + .05);
        const link = document.querySelector('.data-source-links a')!;
        const card = link.closest('.card')!;
        const mark = document.querySelector('.brand-mark')!;
        const theme = getComputedStyle(document.documentElement);
        return {
          link: contrast(getComputedStyle(link).color, getComputedStyle(card).backgroundColor),
          mark: contrast(getComputedStyle(mark).color, getComputedStyle(mark).backgroundColor),
          muted: contrast(theme.getPropertyValue('--muted'), theme.getPropertyValue('--bg')),
          positive: contrast(theme.getPropertyValue('--up'), theme.getPropertyValue('--surface')),
        };
      });
      expect(ratios.link).toBeGreaterThanOrEqual(4.5);
      expect(ratios.mark).toBeGreaterThanOrEqual(4.5);
      expect(ratios.muted).toBeGreaterThanOrEqual(4.5);
      expect(ratios.positive).toBeGreaterThanOrEqual(4.5);
    }
  }
});
