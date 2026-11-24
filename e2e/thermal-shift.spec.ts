import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-46';
const LABELS = ['126', '127L', '127H', '128L', '128H', '129L', '129H', '130L', '130H', '131L'];
const TEMPERATURES = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67];

test('TPP-04: results page — thermal shifts: ΔTm against adjusted p with a table, and melting curves', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('TPP'), [
    {
      file: 'tools/tpp/tr_results.tsv',
      importer: 'tpp_tr',
      options: {
        compound_id: 'CPD-000005',
        feature_type: 'gene',
        temperatures: Object.fromEntries(LABELS.map((l, i) => [l, TEMPERATURES[i]])),
      },
    },
  ]);
  await page.goto(`/experiments/${made.experiment}/results`);
  const section = page.getByRole('region', { name: 'Thermal shift' });
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section).toContainText('ΔTm = melting point of the treatment − vehicle');
  await expect(section.getByRole('figure', { name: /Thermal shift/ })).toBeVisible({ timeout: 30_000 });
  const table = section.getByRole('table', { name: 'Thermal shifts' });
  const tp53 = table.getByRole('row', { name: /TP53.*CPD5_1 vs Vehicle_1/ });
  await expect(tp53).toContainText('6.09');
  await expect(tp53).toContainText('2.88e-3');
  // A comparison that failed the tool's filter has no p-value; the table says so instead of leaving a blank.
  await expect(table.getByRole('row', { name: /PTEN.*CPD5_1 vs Vehicle_1/ })).toContainText('not tested');
  await expect(section.getByRole('figure', { name: /Melting curves/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/thermal-shift.png`, fullPage: true });
});
