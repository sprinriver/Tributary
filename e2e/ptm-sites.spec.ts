import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-47';

test('PTM-04: modification sites — a site summary on the results page and a site map on the protein page', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('PTM'), [
    { file: 'tools/maxquant/Phospho_STY_Sites.txt', importer: 'maxquant_sites' },
  ]);
  await page.goto(`/experiments/${made.experiment}/results`);
  const summary = page.getByRole('region', { name: 'Modification sites' });
  await expect(summary).toBeVisible({ timeout: 30_000 });
  await expect(summary).toContainText(/41 Phospho \(STY\) sites/);
  await expect(summary).toContainText('localisation probability ≥ 0.75');
  await expect(summary.getByRole('table', { name: 'Sites per sample' }).getByRole('row')).toHaveCount(7);
  await page.screenshot({ path: `${SHOTS}/results-sites.png`, fullPage: true });

  await page.goto('/proteins/P31749');
  const sites = page.getByRole('region', { name: 'Modification sites' });
  await expect(sites.getByRole('figure', { name: /Site map/ })).toBeVisible({ timeout: 30_000 });
  const table = sites.getByRole('table', { name: 'Sites' });
  await expect(table.getByRole('row', { name: /S473/ }).first()).toContainText('6 / 6');
  await expect(sites).toContainText('display threshold');
  // A stricter threshold marks S473 (0.80) as below it, without dropping it.
  await sites.getByLabel('Localisation at least').fill('0.85');
  await sites.getByRole('button', { name: 'Apply' }).click();
  await expect(table.getByRole('row', { name: /S473/ }).first()).toContainText('below');
  await page.screenshot({ path: `${SHOTS}/protein-sites.png`, fullPage: true });
});
