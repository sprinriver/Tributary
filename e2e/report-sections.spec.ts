import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CURVE_OPTIONS, publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-39';

test('REP-07: the report adds QC, pathway enrichment and dose-response sections, also in the PowerPoint', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('REP-FULL'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
    { file: 'report.pg_matrix.tsv', importer: 'diann_pg_matrix' },
    { file: 'experiments/ONC-DIA-01/curves.txt', importer: 'curvecurator', options: CURVE_OPTIONS },
  ]);
  await page.goto(`/experiments/${made.experiment}/report`);

  const qc = page.getByRole('region', { name: 'QC' });
  await expect(qc).toContainText(
    /IDs and missing values per sample, CV within each condition \(from the sample sheet\)/,
    {
      timeout: 30_000,
    },
  );
  await expect(qc.locator('.js-plotly-plot')).toBeVisible({ timeout: 60_000 });

  const dose = page.getByRole('region', { name: 'Dose-response' });
  await expect(dose).toContainText(/\d+ up, \d+ down, (> )?\d+ not regulated, \d+ unclassified/, {
    timeout: 30_000,
  });
  await expect(dose).toContainText('pEC50 = −log10(EC50 in M)');
  await expect(
    dose.getByRole('table', { name: 'Top dose-response curves' }).getByRole('row'),
  ).not.toHaveCount(1, { timeout: 30_000 });
  await expect(dose.locator('.js-plotly-plot')).toBeVisible({ timeout: 60_000 });

  // Enrichment is added on demand: it uses the report's hit thresholds.
  const enrichment = page.getByRole('region', { name: 'Pathway enrichment' });
  await enrichment
    .getByLabel('Gene sets')
    .selectOption({ label: 'Demo modules (synthetic) — synthetic demo-1' });
  await enrichment.getByLabel('Minimum set size').fill('5');
  await enrichment.getByRole('button', { name: 'Add to report' }).click();
  await expect(enrichment).toContainText(/adjusted p ≤ 0.05 and \|log2 FC\| ≥ 1/, { timeout: 30_000 });
  const terms = enrichment.getByRole('table', { name: /^Enrichment — / });
  await expect(terms.getByRole('row').nth(1)).toBeVisible({ timeout: 30_000 });
  await expect(terms).toContainText('Synthetic module');
  await page.screenshot({ path: `${SHOTS}/report-sections.png`, fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(enrichment.getByLabel('Gene sets')).toBeHidden(); // controls are not printed
  await page.emulateMedia({ media: 'screen' });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: 'Download PowerPoint' }).click(),
  ]);
  const path = info.outputPath('report.pptx');
  await download.saveAs(path);
  const bytes = readFileSync(path);
  // title, methods, QC, contrast, top hits, enrichment intro, enrichment table, dose-response, top curves
  expect(bytes.includes(Buffer.from('ppt/slides/slide9.xml'))).toBe(true);
});
