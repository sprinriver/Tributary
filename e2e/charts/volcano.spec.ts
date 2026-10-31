import { expect, test } from '@playwright/test';
import { chartOnDa, SHOTS } from './charts.ts';

test('VIZ-02: volcano with thresholds and labelled hits; lasso selects rows', async ({ page }) => {
  test.setTimeout(120_000);
  const { chart } = await chartOnDa(page);
  await chart.getByLabel('Chart type').selectOption('volcano');
  // Type-aware pickers: a text column is not offered for a numeric slot.
  await expect(
    chart.getByLabel('X', { exact: true }).locator('option', { hasText: 'feature_id' }),
  ).toHaveCount(0);
  await chart.getByLabel('X', { exact: true }).selectOption('log2_fc');
  await chart.getByLabel('Y', { exact: true }).selectOption('adj_p_value');
  await chart.getByLabel('Label top hits').fill('5');
  // Labelling hits needs a label column: the error sits by the option and Apply waits.
  await expect(chart.getByText('Choose a label column to label hits.')).toBeVisible();
  await expect(chart.getByRole('button', { name: 'Apply' })).toBeDisabled();
  await chart.getByLabel('Label', { exact: true }).selectOption('feature_id');
  await chart.getByLabel('Fold-change threshold').fill('1');
  await chart.getByLabel('p threshold').fill('0.05');
  await chart.getByRole('button', { name: 'Apply' }).click();
  const figure = chart.getByRole('figure', { name: /Volcano/ });
  await expect(figure.locator('.legendtext', { hasText: /^Up \(\d+\)$/ })).toBeVisible({ timeout: 30_000 });
  await expect(figure.locator('.annotation')).toHaveCount(5);
  await expect(figure.locator('.xtitle')).toHaveText('log2_fc');
  await page.screenshot({ path: `${SHOTS}/volcano.png`, fullPage: true });

  // Lasso → rows: a selection lists the selected points.
  await page.evaluate(() => {
    const gd = document.querySelector('.js-plotly-plot') as HTMLElement & {
      data: { customdata: unknown[]; x: number[]; y: number[] }[];
      emit: (event: string, data: unknown) => void;
    };
    const t = gd.data[0]!;
    gd.emit('plotly_selected', {
      points: [0, 1].map((i) => ({
        curveNumber: 0,
        pointIndex: i,
        customdata: t.customdata[i],
        x: t.x[i],
        y: t.y[i],
      })),
    });
  });
  await expect(chart.getByRole('table', { name: 'Selected points' }).getByRole('row')).toHaveCount(3);
});

test('VIZ-04: provenance popover and PNG/SVG export', async ({ page }) => {
  test.setTimeout(120_000);
  const { chart, release } = await chartOnDa(page);
  await chart.getByLabel('Chart type').selectOption('volcano');
  await chart.getByLabel('X', { exact: true }).selectOption('log2_fc');
  await chart.getByLabel('Y', { exact: true }).selectOption('adj_p_value');
  await chart.getByRole('button', { name: 'Apply' }).click();
  await expect(
    chart
      .getByRole('figure', { name: /Volcano/ })
      .locator('.legendtext')
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  await chart.getByRole('button', { name: 'Provenance' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chart provenance' });
  await expect(dialog).toContainText(release);
  await expect(dialog).toContainText(/[0-9a-f]{64}/);
  await expect(dialog).toContainText('−log10(adj_p_value)');
  await page.screenshot({ path: `${SHOTS}/provenance.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Close' }).click();

  for (const format of ['PNG', 'SVG']) {
    const download = page.waitForEvent('download');
    await chart.getByRole('button', { name: `Download ${format}` }).click();
    expect((await download).suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
  }
  // A table alternative for the chart (web UI rule).
  await chart.getByText('Data table').click();
  await expect(chart.getByRole('table', { name: 'Chart data' })).toBeVisible();
});
