import { expect, test } from '@playwright/test';
import { publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-24';

test('ENR-04: results page — pathway enrichment of a contrast against the demo gene sets, with a table alternative', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('ENR'), [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
  ]);
  await page.goto(`/experiments/${made.experiment}/results`);
  const panel = page.getByRole('region', { name: 'Pathway enrichment' });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByLabel('Gene sets').selectOption({ label: 'Demo modules (synthetic) — synthetic demo-1' });
  await panel.getByLabel('Minimum set size').fill('5');
  await panel.getByRole('button', { name: 'Run enrichment' }).click();
  const table = panel.getByRole('table', { name: 'Enrichment results' });
  await expect(table.getByRole('row').nth(1)).toBeVisible({ timeout: 30_000 });
  await expect(table).toContainText('Synthetic module');
  await expect(panel.getByRole('figure', { name: /Enrichment dot plot/ })).toBeVisible();
  // Provenance: what was counted and how.
  await expect(panel).toContainText(/Universe \(measured\): every gene symbol the source tool tested/);
  await expect(panel).toContainText(/hypergeometric/);
  await page.screenshot({ path: `${SHOTS}/enrichment.png`, fullPage: true });

  // Changing a control invalidates the shown result until it is run again.
  await panel.getByLabel('Direction').selectOption('up');
  await expect(table).toHaveCount(0);
});
