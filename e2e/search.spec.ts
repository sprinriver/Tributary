import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-17';

// Needs the seeded corpus (`pnpm db:seed` indexes it for search).
test('SRCH-03: ⌘K palette finds a seeded experiment by cell line and opens it', async ({ page }) => {
  await signIn(page, 'scientist');
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox', { name: 'Search experiments and samples' }).fill('HEK293 dose series');
  const option = palette.getByRole('option', { name: /IMM-DIA-04: dose series in HEK293/ });
  await expect(option).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/palette.png` });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('IMM-DIA-04');
  // Escape closes the palette without navigating.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('SRCH-03: search page shows hits with facets; a facet narrows the hits and lives in the URL', async ({
  page,
}) => {
  await signIn(page, 'scientist', '/search?q=K-562');
  const results = page.getByRole('region', { name: 'Search results' });
  await expect(results.getByRole('link', { name: /IMM-RNA-10/ })).toBeVisible();
  const facets = page.getByRole('region', { name: 'Filters' });
  await expect(facets.getByRole('group', { name: 'Assay type' })).toContainText('RNA-seq');
  await page.screenshot({ path: `${SHOTS}/search-page.png`, fullPage: true });
  await facets.getByRole('checkbox', { name: /RNA-seq/ }).check();
  await expect(page).toHaveURL(/assay_type=rnaseq/);
  await expect(results.getByRole('link', { name: /IMM-RNA-10/ })).toBeVisible();
  await expect(results.getByRole('link', { name: /IMM-DIA-03/ })).toHaveCount(0);
  // Matched words are highlighted in the snippet.
  await expect(results.locator('mark').first()).toBeVisible();
  // A query with no hits says so.
  await page.getByRole('searchbox', { name: 'Search' }).fill('qqqnothingmatches');
  await page.getByRole('searchbox', { name: 'Search' }).press('Enter');
  await expect(results).toContainText('No experiments or samples match');
});
