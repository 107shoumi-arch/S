import { expect, test } from '@playwright/test';

const quotes = [
  { symbol: '2330', name: '台積電', price: 2425, change: 5, changePercent: 0.21, volume: 40000000, asOf: '2026-10-28', source: '自動測試資料', market: 'TWSE', kind: 'stock', delayed: true },
  { symbol: '0050', name: '元大台灣50', price: 108.65, change: 2.05, changePercent: 1.92, volume: 53628148, asOf: '2026-10-28', source: '自動測試資料', market: 'TWSE', kind: 'etf', delayed: true },
];

test('切換代號同步修正股價與商品類型，並可修改原交易', async ({ page }) => {
  await page.route('**/api/market**', route => route.fulfill({ json: {
    quotes, index: { name: '加權指數', value: 47035.58, change: 939.35, asOf: '2026-10-28', source: '自動測試資料' },
    fetchedAt: new Date().toISOString(), errors: [], cached: false,
  } }));
  await page.route('**/api/history**', route => route.fulfill({ json: { candles: [], source: '', asOf: null, errors: [] } }));
  await page.goto('/');

  await expect(page.getByText(/不是今日行情/).first()).toBeVisible();
  await page.getByRole('button', { name: '新增交易', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('買入或賣出價格')).toHaveValue('2425');

  await dialog.getByLabel('股票代號').fill('0050');
  await expect(dialog.getByLabel('買入或賣出價格')).toHaveValue('108.65');
  await expect(dialog.locator('select[name="kind"]')).toHaveValue('etf');

  await dialog.getByLabel('交易日期').fill('2026-10-28');
  await dialog.getByLabel('買入或賣出股數').fill('303');
  await dialog.getByLabel('買入或賣出價格').fill('2425');
  page.once('dialog', warning => warning.dismiss());
  await dialog.getByRole('button', { name: '儲存交易' }).click();
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('買入或賣出價格').fill('108.65');
  await dialog.getByRole('button', { name: '儲存交易' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.position')).toContainText('0050');
  await expect(page.locator('.position')).toContainText('303 股');

  await page.locator('.ledger-disclosure summary').click();
  await page.getByRole('button', { name: '修改 2026-10-28 0050 交易' }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByLabel('股票代號')).toHaveValue('0050');
  await editor.getByLabel('買入或賣出價格').fill('105');
  await editor.getByRole('button', { name: '儲存修正' }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.locator('.position')).toContainText('303 股');
  await expect(page.locator('.position')).toContainText('105');
  await expect(page.locator('.transaction-row')).toHaveCount(1);
});
