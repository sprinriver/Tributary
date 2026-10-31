import { expect, test, type Page } from '@playwright/test';
import { addRule, CONTRAST, daRelease, pickRelease } from './data.ts';
import { apiCall, signIn, uniqueName } from './helpers.ts';

// Needs the local stack, `pnpm db:migrate` and `pnpm db:seed`.
const SHOTS = 'artifacts/phase-13';
/** Cell texts of one column in display order. */
async function column(page: Page, colId: string): Promise<string[]> {
  return page.evaluate((id) => {
    const rows = [...document.querySelectorAll('[role="row"][row-index]')].filter((r) =>
      r.querySelector(`[role="gridcell"][col-id="${id}"]`),
    );
    rows.sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index')));
    return rows.map((r) => r.querySelector(`[role="gridcell"][col-id="${id}"]`)?.textContent ?? '');
  }, colId);
}

test('EXP-03: SPEC M6 check — filter, sort, page 3 in < 2 s, export equals rows, save view, reopen via link', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page, 'scientist');
  const name = uniqueName('EXP-DA');
  await daRelease(page, name);

  await page.goto('/explore');
  await expect(page.getByRole('heading', { level: 1, name: 'Data Explorer' })).toBeVisible();
  await pickRelease(page, name);
  const filters = page.getByRole('region', { name: 'Filters' });
  await addRule(page, filters, 'feature_id', 'beginsWith', 'SYNP');
  await addRule(page, filters, 'adj_p_value', '<', '0.9');
  await page.getByRole('button', { name: 'Run query' }).click();
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByText('95 rows')).toBeVisible();

  await results.getByRole('columnheader', { name: 'log2_fc' }).click();
  await expect(results.getByText('sorted by log2_fc ascending')).toBeVisible();
  await results.getByRole('button', { name: 'Next page' }).click();
  await expect(results.getByText('Page 2 of 4')).toBeVisible();
  const started = Date.now();
  await results.getByRole('button', { name: 'Next page' }).click();
  await expect(results.getByText('Page 3 of 4')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2000);
  const page3 = await column(page, 'feature_id');
  expect(page3).toHaveLength(25);
  await page.screenshot({ path: `${SHOTS}/page-3.png`, fullPage: true });

  await results.getByRole('button', { name: 'Export' }).click();
  await page.getByRole('menuitem', { name: 'CSV' }).click();
  const link = results.getByRole('link', { name: 'Download CSV' });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const csv = (await (await request.get((await link.getAttribute('href'))!)).text()).trim().split('\n');
  expect(csv).toHaveLength(96);
  expect(csv.slice(51, 76).map((l) => l.split(',')[csv[0]!.split(',').indexOf('feature_id')])).toEqual(page3);

  await page.getByRole('button', { name: 'Save view' }).click();
  const save = page.getByRole('dialog', { name: 'Save view' });
  await save.getByLabel('Name').fill(name);
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/[?&]view=/);
  const url = page.url();
  const reopened = await page.context().newPage();
  await reopened.goto(url);
  await expect(reopened.getByRole('region', { name: 'Results' }).getByText('95 rows')).toBeVisible();
  await expect(reopened.getByRole('region', { name: 'Filters' }).locator('.rule')).toHaveCount(2);
  await reopened.screenshot({ path: `${SHOTS}/saved-view.png`, fullPage: true });
});

test('EXP-02: join builder — left join to sample metadata with a per-join filter', async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, 'scientist');
  const name = uniqueName('EXP-JOIN');
  await daRelease(page, name);
  await page.goto('/explore');
  await pickRelease(page, name);
  await page.getByRole('button', { name: 'Add join' }).click();
  const join = page.getByRole('region', { name: 'Join 1' });
  await join.getByLabel('Join type').selectOption('left');
  await join.getByLabel('Join dataset kind').selectOption('sample');
  await join.getByLabel('Alias').fill('s');
  await join.getByLabel('Left column').selectOption('experiment_version_id');
  await join.getByLabel('Right column').selectOption('experiment_version_id');
  await addRule(page, join, 'condition', '=', CONTRAST.numerator);
  await page.getByRole('button', { name: 'Run query' }).click();
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('columnheader', { name: 's.dose_display' })).toBeVisible();
  await expect(results.getByRole('gridcell', { name: '1 µM' }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/join.png`, fullPage: true });
});

test('EXP-01: metadata tables are pickable (samples of my programs)', async ({ page }) => {
  await signIn(page, 'scientist');
  await page.goto('/explore');
  const picker = page.getByRole('region', { name: 'Dataset' });
  await picker.getByLabel('Dataset kind').selectOption('sample');
  await page.getByRole('button', { name: 'Run query' }).click();
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByText(/\d+ rows/)).toBeVisible();
  await expect(results.getByRole('columnheader', { name: 'sample_key' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/metadata.png`, fullPage: true });
});

test('EXP-04: a private saved view is not visible to another user', async ({ page, browser }) => {
  await signIn(page, 'scientist');
  await page.goto('/explore');
  await page.getByRole('region', { name: 'Dataset' }).getByLabel('Dataset kind').selectOption('sample');
  await page.getByRole('button', { name: 'Run query' }).click();
  await page.getByRole('button', { name: 'Save view' }).click();
  const save = page.getByRole('dialog', { name: 'Save view' });
  await save.getByLabel('Name').fill(uniqueName('EXP-PRIVATE'));
  await save.getByLabel('Visibility').selectOption('private');
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/[?&]view=/);
  const other = await (await browser.newContext()).newPage();
  await signIn(other, 'viewer');
  await other.goto(page.url().replace(/^https?:\/\/[^/]+/, ''));
  await expect(other.getByRole('alert')).toContainText('View not found');
});

test('EXP-05: copy as Python, R or QuerySpec JSON', async ({ page }) => {
  await signIn(page, 'scientist');
  await page.goto('/explore');
  await page.getByRole('region', { name: 'Dataset' }).getByLabel('Dataset kind').selectOption('sample');
  await page.getByRole('button', { name: 'Copy as code' }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy as code' });
  await expect(dialog.getByRole('code')).toContainText('requests.post(');
  await expect(dialog.getByRole('code')).toContainText('/v1/query');
  await dialog.getByRole('tab', { name: 'R', exact: true }).click();
  await expect(dialog.getByRole('code')).toContainText('httr2::request(');
  await dialog.getByRole('tab', { name: 'QuerySpec JSON' }).click();
  const spec = JSON.parse((await dialog.getByRole('code').textContent())!) as { source: { kind: string } };
  expect(spec.source.kind).toBe('sample');
  await page.screenshot({ path: `${SHOTS}/copy-as-code.png`, fullPage: true });
});
