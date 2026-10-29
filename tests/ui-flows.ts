import { expect, type Page } from '@playwright/test';

/** Follow the same disclosure controls a person uses; never force hidden inputs. */
export async function openGroup(page: Page, label: string) {
  const words = label.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const group = page.locator('details').filter({
    has: page.locator('summary').filter({ hasText: new RegExp(words.join('\\s*')) }),
  }).first();
  await expect(group).toBeAttached();
  if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
  await expect(group).toHaveAttribute('open', '');
  return group;
}

export async function showCalculator(page: Page) {
  await page.getByRole('button', { name: '試算', exact: true }).click();
  await expect(page.locator('.risk-card')).toBeVisible();
}
