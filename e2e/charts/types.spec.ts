import { expect, test } from '@playwright/test';
import { chartOnDa, chartOnPq, drawChart, SHOTS } from './charts.ts';

test('VIZ-05: line, bar, scatter 2D/3D, box/violin, histogram/KDE, lollipop, bubble and pie/donut render', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const { chart } = await chartOnDa(page, 0.5);
  const cases: [string, RegExp, Record<string, string>][] = [
    ['line', /Line/, { X: 'avg_log2_abundance', Y: 'log2_fc' }],
    ['bar', /Bar/, { X: 'feature_type', Y: 'log2_fc' }],
    ['scatter2d', /Scatter 2D/, { X: 'log2_fc', Y: 't_stat' }],
    ['scatter3d', /Scatter 3D/, { X: 'log2_fc', Y: 't_stat', Z: 'avg_log2_abundance' }],
    ['box_violin', /Box/, { X: 'feature_type', Y: 'log2_fc' }],
    ['histogram_kde', /Histogram/, { X: 'log2_fc' }],
    ['lollipop', /Lollipop/, { 'Row label': 'feature_id', X: 'log2_fc' }],
    ['bubble', /Bubble/, { X: 'log2_fc', Y: 't_stat', Size: 'avg_log2_abundance' }],
    ['pie_donut', /Pie/, { Categories: 'feature_type', Values: 'avg_log2_abundance' }],
  ];
  for (const [type, label, slots] of cases) {
    await drawChart(page, chart, type, label, slots);
    await page.screenshot({ path: `${SHOTS.replace('14', '15')}/${type}.png`, fullPage: true });
  }
});

test('VIZ-06: v1 defects show field-level messages and keep Apply disabled', async ({ page }) => {
  test.setTimeout(120_000);
  const { chart } = await chartOnDa(page);
  await chart.getByLabel('Chart type').selectOption('scatter2d');
  await chart.getByLabel('X', { exact: true }).selectOption('log2_fc');
  await expect(chart.getByText('Choose a column for y.')).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Apply' })).toBeDisabled();

  await chart.getByLabel('Chart type').selectOption('histogram_kde');
  await chart.getByLabel('X', { exact: true }).selectOption('log2_fc');
  await chart.getByLabel('p-values').selectOption('kruskal');
  await expect(chart.getByText('p-values compare colour groups: choose a colour column.')).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS.replace('14', '15')}/defect-pvalues.png`, fullPage: true });
});

test('VIZ-07: MA plot and PCA (scores and variance explained)', async ({ page }) => {
  test.setTimeout(180_000);
  const { chart } = await chartOnDa(page);
  const ma = await drawChart(page, chart, 'ma', /MA plot/, {
    X: 'avg_log2_abundance',
    Y: 'log2_fc',
    'Adjusted p': 'adj_p_value',
  });
  await expect(ma.locator('.legendtext', { hasText: /^Up \(\d+\)$/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS.replace('14', '15')}/ma.png`, fullPage: true });

  const pq = await chartOnPq(page, { signedIn: true });
  const pca = await drawChart(
    page,
    pq,
    'pca',
    /PCA/,
    { 'Row label': 'sample_key', 'Feature (long data)': 'protein_group' },
    { Values: ['log2_intensity'] },
  );
  await expect(pca.locator('.xtitle')).toHaveText(/^PC1 \(\d+\.\d%\)$/);
  await page.screenshot({ path: `${SHOTS.replace('14', '15')}/pca.png`, fullPage: true });
});

test('VIZ-08: QC panel — IDs per run, missing values, CVs and intensity distributions', async ({ page }) => {
  test.setTimeout(180_000);
  const chart = await chartOnPq(page);
  const qc = await drawChart(page, chart, 'qc_panel', /QC panel/, {
    Run: 'sample_key',
    'Row label': 'protein_group',
    Values: 'intensity',
  });
  for (const title of ['IDs per run', 'Missing values (%)', 'CV (%)', 'log2 intensity'])
    await expect(qc.locator('.annotation-text', { hasText: title })).toBeVisible();
  await page.screenshot({ path: `${SHOTS.replace('14', '15')}/qc-panel.png`, fullPage: true });
});
