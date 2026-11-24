import { expect, test } from '@playwright/test';
import { CURVE_OPTIONS, publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-49';
const LABELS = ['126', '127L', '127H', '128L', '128H', '129L', '129H', '130L', '130H', '131L'];
const TEMPS = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67];

test('EVD-02: compound page — target evidence from dose-response and thermal profiling, per protein', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, 'scientist');
  await publishedExperiment(page, uniqueName('EVD'), [
    { file: 'experiments/ONC-DIA-01/curves.txt', importer: 'curvecurator', options: CURVE_OPTIONS },
    {
      file: 'tools/tpp/tr_results.tsv',
      importer: 'tpp_tr',
      dataset: 'CPD-000001 TPP-TR',
      options: {
        compound_id: CURVE_OPTIONS.compound_id,
        feature_type: 'gene',
        temperatures: Object.fromEntries(LABELS.map((l, i) => [l, TEMPS[i]])),
      },
    },
  ]);
  await page.goto(`/compounds/${CURVE_OPTIONS.compound_id}`);
  const section = page.getByRole('region', { name: 'Target evidence' });
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section).toContainText(/no combined score/i);
  const table = section.getByRole('table', { name: 'Target evidence' });
  await expect(table.getByRole('row', { name: /TP53/ }).first()).toContainText('primary target');
  await expect(table.getByRole('row', { name: /AKT1/ }).first()).toContainText('+');
  await page.addStyleTag({ content: '.topbar { position: static !important; }' }); // not over the capture
  await section.screenshot({ path: `${SHOTS}/target-evidence.png` });
});
