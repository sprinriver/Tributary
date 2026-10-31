import { expect, test } from '@playwright/test';
import { CONTRAST, CURVE_OPTIONS, demoRun, publishedExperiment } from './data.ts';
import { signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-16';

test('RES-01: after the demo run the results page shows QC, a volcano per contrast, top hits and the methods paragraph', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, 'scientist');
  const name = uniqueName('RES-RUN');
  const run = await demoRun(page, name);
  await page.goto(`/experiments/${run.experiment}`);
  await page.getByRole('link', { name: 'Results' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  const methods = page.getByRole('region', { name: 'Methods' });
  await expect(methods).toContainText('pipelines/demo');
  await expect(methods).toContainText('revision local');
  await expect(methods).toContainText(CONTRAST.label);
  await expect(page.getByRole('region', { name: 'QC' }).getByRole('figure')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('region', { name: `Volcano — ${CONTRAST.label}` }).getByRole('figure'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('table', { name: 'Top hits' }).getByRole('row')).not.toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Files' })).toContainText('toptable.tsv');
  await page.screenshot({ path: `${SHOTS}/results-page.png`, fullPage: true });
});

test('RES-02: dose-response viewer — fitted curves as small multiples, filtered by regulation and FDR', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const made = await publishedExperiment(page, uniqueName('RES-DR'), [
    { file: 'experiments/ONC-DIA-01/curves.txt', importer: 'curvecurator', options: CURVE_OPTIONS },
  ]);
  await page.goto(`/experiments/${made.experiment}/results`);
  const viewer = page.getByRole('region', { name: 'Dose-response' });
  const figure = viewer.getByRole('figure');
  await expect(figure.locator('.annotation-text').first()).toBeVisible({ timeout: 30_000 });
  const regulated = await figure.locator('.annotation-text').count();
  await viewer.getByRole('checkbox', { name: 'not' }).check();
  await viewer.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(async () => figure.locator('.annotation-text').count()).toBeGreaterThan(regulated);
  await viewer.getByLabel('FDR at most').fill('0.0001');
  await viewer.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(async () => figure.locator('.annotation-text').count()).toBeLessThan(regulated + 1);
  await page.screenshot({ path: `${SHOTS}/dose-response.png`, fullPage: true });
});

test('RES-03: protein page — annotations and every experiment and contrast it was measured in', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, 'scientist');
  const name = uniqueName('RES-PROT');
  await publishedExperiment(page, name, [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
  ]);
  await page.goto('/proteins/P31749');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('P31749');
  await expect(page.getByRole('table', { name: 'Annotations' })).toContainText('cytoplasm');
  const measured = page.getByRole('table', { name: 'Measured in' });
  await expect(measured).toContainText(name, { timeout: 30_000 });
  await expect(measured).toContainText(CONTRAST.label);
  await page.screenshot({ path: `${SHOTS}/protein.png`, fullPage: true });
});

test('RES-04: compound page — contrasts, ADME rows, targets and a known-target overlay on its volcano', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const name = uniqueName('RES-CPD');
  await publishedExperiment(page, name, [
    { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
    {
      file: 'reference/compound_targets.tsv',
      importer: 'reference_target_annotation',
      dataset: `${name} targets`,
    },
  ]);
  await page.goto('/compounds/CPD-000005');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('CPD-000005');
  await expect(page.getByRole('table', { name: 'Properties' })).toContainText('ADME');
  await expect(page.getByRole('table', { name: 'Contrasts' })).toContainText(name);
  await expect(page.getByRole('table', { name: 'Targets' })).toContainText('primary_target', {
    timeout: 30_000,
  });
  const volcano = page.getByRole('region', { name: `Volcano — ${name}` }).getByRole('figure');
  await expect(volcano.locator('.legendtext', { hasText: /^Known targets \(\d+\)$/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: `${SHOTS}/compound.png`, fullPage: true });
});

test('RES-05: comparison of two contrasts — log2_fc scatter, overlap table and intersection bars', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await signIn(page, 'scientist');
  const [n1, n2] = [uniqueName('RES-CMP-A'), uniqueName('RES-CMP-B')];
  for (const n of [n1, n2])
    await publishedExperiment(page, n, [
      { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true },
    ]);
  await page.goto('/compare');
  for (const n of [n1, n2]) await page.getByRole('checkbox', { name: new RegExp(n) }).check();
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(
    page.getByRole('region', { name: 'log2 fold change scatter' }).getByRole('figure'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('region', { name: 'Intersections' }).getByRole('figure')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Overlap' }).getByRole('row')).not.toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/compare.png`, fullPage: true });
});
