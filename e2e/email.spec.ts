import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-34';

test('MAIL-01: a scientist turns off one kind of email from the user menu, and it stays off', async ({
  page,
}) => {
  await signIn(page, 'scientist', '/');
  await page.getByRole('button', { name: 'Scientist Dev' }).click();
  await page.getByRole('menuitem', { name: 'Email notifications' }).click();
  await expect(page.getByRole('heading', { name: 'Email notifications' })).toBeVisible();
  const settings = page.getByRole('region', { name: 'Email settings' });
  const runs = settings.getByLabel(/My pipeline runs finish/);
  // Start from a known state (other tests may have saved settings).
  if (!(await runs.isChecked())) {
    await runs.check();
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(settings.getByRole('status')).toHaveText('Saved');
  }
  await runs.uncheck();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings.getByRole('status')).toHaveText('Saved');
  await page.screenshot({ path: `${SHOTS}/email-settings.png`, fullPage: true });
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Email settings' }).getByLabel(/My pipeline runs finish/),
  ).not.toBeChecked();
});
