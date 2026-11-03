import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-27';

test('QCD-03: the QC page shows IDs per run, a PCA of runs coloured by plate and a table', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist', '/');
  for (const name of [uniqueName('QCD-A'), uniqueName('QCD-B')])
    await publishedExperiment(page, name, [{ file: 'report.pg_matrix.tsv', importer: 'diann_pg_matrix' }]);

  await page.goto('/qc');
  await expect(page.getByRole('heading', { name: 'Cross-experiment QC' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /runs in \d+ experiments/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('region', { name: 'IDs per run' }).locator('.js-plotly-plot')).toBeVisible();
  await page.getByLabel('Colour PCA by').selectOption('plate');
  await expect(page).toHaveURL(/color_by=plate/);
  const pca = page.getByRole('region', { name: 'PCA of runs' });
  await expect(pca.locator('.js-plotly-plot')).toBeVisible({ timeout: 30_000 });
  await expect(pca).toContainText(/protein groups quantified in every run/);
  const table = page.getByRole('table', { name: 'QC per run' });
  await expect(table.getByRole('row').filter({ hasText: 'ONC-DIA-05-S01' }).first()).toContainText(
    'ONC-DIA-05-P1',
  );
  await page.screenshot({ path: `${SHOTS}/qc-overview.png`, fullPage: true });
});
