import { expect, type Page } from '@playwright/test';
import { addRule, daRelease, pickRelease } from '../data.ts';
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
