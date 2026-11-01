import { expect, test } from '@playwright/test';

// Needs the local stack (docker compose up -d) and `pnpm db:migrate`; Keycloak users from infra/local/keycloak.
test('AUTH-01: scientist signs in through Keycloak, sees their name, and signs out', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).click();

  await page.getByLabel(/username/i).fill('scientist');
  await page.getByLabel('Password', { exact: true }).fill('scientist');
  await page.getByRole('button', { name: /sign in/i }).click();

  const menu = page.getByRole('button', { name: /Scientist Dev/ });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByText('scientist@example.test')).toBeVisible();
  await page.screenshot({ path: 'artifacts/phase-3/signed-in.png' });

  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('AUTH-01: a signed-out visitor to a protected page is sent to sign in', async ({ page }) => {
  await page.goto('/experiments');
  await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});
