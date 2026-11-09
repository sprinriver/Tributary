import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

test('QCD-05: the report and results QC compute CVs within each condition from the sample sheet', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('QC-COND'), [
    { file: 'report.pg_matrix.tsv', importer: 'diann_pg_matrix' },
  ]);
  await page.goto(`/experiments/${made.experiment}/report`);
  const qc = page.getByRole('region', { name: 'QC' });
  await expect(qc).toContainText('CV within each condition', { timeout: 30_000 });
  await expect(qc.locator('.js-plotly-plot')).toBeVisible({ timeout: 60_000 });
  // The CV panel has one box per condition of the fixture's sample sheet.
  await expect(qc).toContainText(/CV = SD \/ mean of linear intensity per feature within s\.condition/);
  await expect(qc.locator('.js-plotly-plot')).toContainText('DMSO');

  await page.goto(`/experiments/${made.experiment}/results`);
  const results = page.getByRole('region', { name: 'QC' });
  await expect(results).toContainText(/within s\.condition/, { timeout: 60_000 });
});
