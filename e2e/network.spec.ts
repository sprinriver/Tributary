import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-30';

test('NET-02: after an enrichment, the gene–concept network and its table show the sets and their hit genes', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('NET'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
  ]);
  await page.goto(`/experiments/${made.experiment}/results`);
  const panel = page.getByRole('region', { name: 'Pathway enrichment' });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByLabel('Gene sets').selectOption({ label: 'Demo modules (synthetic) — synthetic demo-1' });
  await panel.getByLabel('Minimum set size').fill('5');
  await panel.getByRole('button', { name: 'Run enrichment' }).click();
  const network = panel.getByRole('region', { name: 'Gene–concept network' });
  await expect(network).toBeVisible({ timeout: 30_000 });
  await expect(
    network.getByRole('img', { name: /Network of \d+ gene sets and \d+ hit genes/ }),
  ).toBeVisible();
  await expect(network.locator('canvas').first()).toBeVisible({ timeout: 20_000 });
  const links = network.getByRole('table', { name: 'Gene–concept links' });
  await expect(links.getByRole('row').nth(1)).toContainText('Synthetic module');
  await network.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800); // let the layout settle for the screenshot
  await network.screenshot({ path: `${SHOTS}/gene-concept-network.png` });
});
