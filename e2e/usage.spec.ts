import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-36';

test('USE-03: an admin sees usage by week, program and person, and downloads the weekly table', async ({
  page,
}, info) => {
  await signIn(page, 'admin', '/admin/usage');
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Headline numbers' })).toContainText('Active in 30 days');
  const weekly = page.getByRole('region', { name: 'Weekly activity' });
  await expect(weekly.locator('.js-plotly-plot')).toBeVisible({ timeout: 30_000 });
  await expect(weekly.getByRole('table', { name: 'Weekly activity table' }).getByRole('row')).toHaveCount(13);
  await expect(page.getByRole('table', { name: 'Programs table' })).toContainText('ONC');
  await expect(page.getByRole('table', { name: 'People table' })).toContainText('Scientist Dev');
  await page.screenshot({ path: `${SHOTS}/usage.png`, fullPage: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Download CSV' }).click(),
  ]);
  const path = info.outputPath('usage.csv');
  await download.saveAs(path);
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  expect(lines[0]).toBe(
    'week_start,active_users,experiments_created,versions_published,imports,releases_published,pipeline_runs,exports,assistant,triage',
  );
  expect(lines).toHaveLength(13);
});
