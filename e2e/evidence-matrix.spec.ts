import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURVE_OPTIONS, publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-51';

test('EVD-04: Analysis → Target evidence shows the compound × protein matrix with a legend and compound links', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, 'scientist');
  await publishedExperiment(page, uniqueName('MTX'), [
    { file: 'experiments/ONC-DIA-01/curves.txt', importer: 'curvecurator', options: CURVE_OPTIONS },
    {
      // The same curves under another file name: one file per upload in a version.
      file: 'cpd-000002-curves.txt',
      buffer: readFileSync(resolve(import.meta.dirname, '../fixtures/experiments/ONC-DIA-01/curves.txt')),
      importer: 'curvecurator',
      dataset: 'CPD-000002 curves',
      options: { ...CURVE_OPTIONS, compound_id: 'CPD-000002' },
    },
  ]);
  await page.goto('/target-evidence');
  await expect(page.getByRole('heading', { level: 1, name: 'Target evidence' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Compound × protein evidence' });
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole('link', { name: 'CPD-000002' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Legend' })).toContainText('dose-response');
  await expect(page.getByText(/no combined score/i).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/evidence-matrix.png`, fullPage: true });
});
