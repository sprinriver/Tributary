import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-45';

test('PPI-04: results page — the interaction network of a contrast’s hits, with a table and attribution', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('PPI'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
  ]);
  await page.goto(`/experiments/${made.experiment}/results`);
  const panel = page.getByRole('region', { name: 'Interaction network' });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel
    .getByLabel('Interactions')
    .selectOption({ label: 'Demo interactions (synthetic) — synthetic demo-1' });
  await panel.getByLabel('Minimum score').fill('150');
  await panel.getByRole('button', { name: 'Show network' }).click();
  const table = panel.getByRole('table', { name: 'Interactions between hits' });
  await expect(table.getByRole('row').nth(1)).toBeVisible({ timeout: 30_000 });
  await expect(
    panel.getByRole('img', { name: /Network of \d+ hit genes and \d+ interactions/ }),
  ).toBeVisible();
  await expect(panel).toContainText(/\d+ of \d+ hit genes are in this collection/);
  await expect(panel).toContainText('not measured in this experiment');
  await page.screenshot({ path: `${SHOTS}/interaction-network.png`, fullPage: true });

  // Changing a control clears the shown network until it is run again.
  await panel.getByLabel('Minimum score').fill('900');
  await expect(table).toHaveCount(0);
});
