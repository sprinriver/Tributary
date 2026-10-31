import { expect, test } from '@playwright/test';
import { chartOnDa, pickColumns, SHOTS } from './charts.ts';

const VALUES = ['log2_fc', 't_stat', 'avg_log2_abundance'];

test('VIZ-03: heatmap with row and column clustering and dendrograms', async ({ page }) => {
  test.setTimeout(120_000);
  const { chart } = await chartOnDa(page, 0.2);
  await chart.getByLabel('Chart type').selectOption('heatmap');
  await pickColumns(chart, 'Values', VALUES);
  await chart.getByLabel('Row label').selectOption('feature_id');
  await chart.getByLabel('Standardise').selectOption('zscore_columns');
  await chart.getByLabel('Cluster rows').check();
  await chart.getByLabel('Cluster columns').check();
  await chart.getByLabel('Dendrograms').check();
  await chart.getByRole('button', { name: 'Apply' }).click();
  const figure = chart.getByRole('figure', { name: /Heatmap/ });
  await expect(figure.locator('.hm, .heatmaplayer image, .heatmaplayer')).not.toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(figure.locator('.scatterlayer .trace')).not.toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/heatmap-clustered.png`, fullPage: true });

  // v1 failed unless both axes were clustered: rows only works too.
  await chart.getByLabel('Cluster columns').uncheck();
  await chart.getByRole('button', { name: 'Apply' }).click();
  await expect(chart.getByRole('alert')).toHaveCount(0);
  await expect(figure.locator('.scatterlayer .trace')).not.toHaveCount(0);
});

test('VIZ-03: REFERENCE_V1 §8 heatmap and dendrogram defects show field-level errors', async ({ page }) => {
  test.setTimeout(120_000);
  const { chart } = await chartOnDa(page, 0.2);
  await chart.getByLabel('Chart type').selectOption('heatmap');
  await pickColumns(chart, 'Values', VALUES);
  await chart.getByLabel('Row label').selectOption('feature_id');
  // Dendrograms without clustering.
  await chart.getByLabel('Dendrograms').check();
  await expect(chart.getByText('Dendrograms need row or column clustering.')).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await chart.getByLabel('Dendrograms').uncheck();
  // Inverted colour range.
  await chart.getByLabel('Colour minimum').fill('2');
  await chart.getByLabel('Colour maximum').fill('1');
  await expect(chart.getByText('The maximum must be above the minimum.')).toBeVisible();
  await chart.getByLabel('Colour maximum').fill('');
  await chart.getByLabel('Colour minimum').fill('');

  await chart.getByLabel('Chart type').selectOption('dendrogram');
  await pickColumns(chart, 'Values', VALUES);
  await chart.getByLabel('Row label').selectOption('feature_id');
  await chart.getByLabel('Clustering method').selectOption('ward.D2');
  await chart.getByLabel('Distance metric').selectOption('manhattan');
  await expect(chart.getByText('ward.D2 linkage needs the euclidean distance.')).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/dendrogram-error.png`, fullPage: true });
  await chart.getByLabel('Distance metric').selectOption('euclidean');
  await chart.getByLabel('Bootstrap iterations').fill('20');
  await chart.getByRole('button', { name: 'Apply' }).click();
  const figure = chart.getByRole('figure', { name: /Dendrogram/ });
  await expect(figure.locator('.annotation').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/dendrogram-bootstrap.png`, fullPage: true });
});
