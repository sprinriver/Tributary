import { expect, test } from '@playwright/test';

test('OPS-01 smoke: home page shows API health', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tributary' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API: ok');
  await page.screenshot({ path: 'artifacts/phase-0/home.png', fullPage: true });
});
