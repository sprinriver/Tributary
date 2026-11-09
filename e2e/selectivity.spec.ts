import { expect, test } from '@playwright/test';
import { CURVE_OPTIONS, publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-42';

test('SEL-03: the compound page shows its selectivity profile in a profiling experiment, with a table and a threshold', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const name = uniqueName('SEL');
  await publishedExperiment(page, name, [
    { file: 'experiments/ONC-DIA-01/curves.txt', importer: 'curvecurator', options: CURVE_OPTIONS },
  ]);
  await page.goto(`/compounds/${CURVE_OPTIONS.compound_id}`);
  const section = page.getByRole('region', { name: 'Selectivity' });
  // Other tests profile the same compound: pick this test's experiment.
  const option = section.getByRole('option', { name: new RegExp(name) });
  await section.getByLabel('Profiling experiment').selectOption((await option.getAttribute('value'))!);
  await expect(section).toContainText(/16 of 157 proteins tested are engaged/, { timeout: 30_000 });
  await expect(section).toContainText(/S\(1 µM\) = \d+ \/ 157 = 0\.\d{3}/);
  await expect(section.getByRole('figure', { name: /Engaged proteins by pEC50/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(section.getByRole('table', { name: 'Engaged proteins' }).getByRole('row')).toHaveCount(17);
  await expect(section).toContainText('apparent cellular potency, not a binding constant');
  await page.screenshot({ path: `${SHOTS}/selectivity.png`, fullPage: true });

  // A stricter threshold: S(100 nM).
  await section.getByLabel('Potency threshold (pEC50)').fill('7');
  await section.getByRole('button', { name: 'Apply' }).click();
  await expect(section).toContainText(/S\(100 nM\) = \d+ \/ 157/, { timeout: 30_000 });
});
