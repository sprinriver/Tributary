import { expect, type Page } from '@playwright/test';
import { addRule, daRelease, pickRelease, pqRelease } from '../data.ts';
import { signIn, uniqueName } from '../helpers.ts';

export const SHOTS = 'artifacts/phase-14';

/** Signed-in explorer with a DA release run (optionally filtered to adj_p < `adjP`); returns the Chart region. */
export async function chartOnDa(page: Page, adjP?: number) {
  await signIn(page, 'scientist');
  const name = uniqueName('VIZ');
  const ids = await daRelease(page, name);
  await page.goto('/explore');
  await pickRelease(page, name);
  if (adjP !== undefined)
    await addRule(page, page.getByRole('region', { name: 'Filters' }), 'adj_p_value', '<', String(adjP));
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByRole('region', { name: 'Results' }).getByText(/\d+ rows/)).toBeVisible();
  return { chart: page.getByRole('region', { name: 'Chart' }), ...ids };
}

/** Ticks one column in a multi-column picker (fieldset with a checkbox per column). */
export async function pickColumns(chart: ReturnType<Page['getByRole']>, slot: string, columns: string[]) {
  const group = chart.getByRole('group', { name: slot });
  for (const c of columns) await group.getByRole('checkbox', { name: c, exact: true }).check();
}

/** Signed-in explorer on a protein_quant release (all rows); returns the Chart region. */
export async function chartOnPq(page: Page, options: { signedIn?: boolean } = {}) {
  if (!options.signedIn) await signIn(page, 'scientist');
  const name = uniqueName('VIZ-PQ');
  await pqRelease(page, name);
  await page.goto('/explore');
  const picker = page.getByRole('region', { name: 'Dataset' });
  await picker.getByLabel('Dataset kind').selectOption('protein_quant');
  const release = picker.getByLabel('Release');
  await release.selectOption({ label: (await release.locator('option', { hasText: name }).textContent())! });
  await page.getByRole('button', { name: 'Run query' }).click();
  await expect(page.getByRole('region', { name: 'Results' }).getByText(/\d+ rows/)).toBeVisible();
  return page.getByRole('region', { name: 'Chart' });
}

/** Picks a chart type, fills single-column slots (by label) and multi-column slots, applies, waits for the figure. */
export async function drawChart(
  page: Page,
  chart: ReturnType<Page['getByRole']>,
  type: string,
  label: RegExp,
  slots: Record<string, string>,
  multi: Record<string, string[]> = {},
) {
  await chart.getByLabel('Chart type').selectOption(type);
  for (const [slot, column] of Object.entries(slots))
    await chart.getByLabel(slot, { exact: true }).selectOption(column);
  for (const [slot, columns] of Object.entries(multi)) await pickColumns(chart, slot, columns);
  await chart.getByRole('button', { name: 'Apply' }).click();
  const figure = chart.getByRole('figure', { name: label });
  await expect(figure.locator('.main-svg').first()).toBeVisible({ timeout: 30_000 });
  await expect(chart.getByRole('alert')).toHaveCount(0);
  return figure;
}
