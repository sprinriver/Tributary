import { expect, test } from '@playwright/test';
import { CURVE_OPTIONS, publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-43';

test('SEL-05: the Selectivity page ranks profiled compounds and opens a compound’s profile', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const name = uniqueName('SELT');
  await publishedExperiment(page, name, [
    { file: 'experiments/ONC-DIA-01/curves.txt', importer: 'curvecurator', options: CURVE_OPTIONS },
  ]);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Selectivity' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Selectivity' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Compound selectivity' });
  const row = table.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText(CURVE_OPTIONS.compound_id, { timeout: 30_000 });
  await expect(row).toContainText('16 / 138');
  await expect(page.getByRole('main')).toContainText(
    'apparent potency in each assay, not a binding constant',
  );
  await page.screenshot({ path: `${SHOTS}/selectivity-table.png`, fullPage: true });

  await row.getByRole('link', { name: CURVE_OPTIONS.compound_id }).click();
  await expect(page).toHaveURL(/\/compounds\/CPD-000001\?.*sel_release=/);
  await expect(page.getByRole('region', { name: 'Selectivity' })).toContainText(/16 of 138 proteins tested/, {
    timeout: 30_000,
  });
});
