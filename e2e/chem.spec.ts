import { expect, test } from '@playwright/test';
import { signIn } from './helpers.ts';

const SHOTS = 'artifacts/phase-28';

// Seeded demo compounds (fixtures/reference/compounds.tsv): CPD-000001 and CPD-000002 are anilides.
test('CHEM-04: search a substructure, open a hit, see its structure and descriptors', async ({ page }) => {
  await signIn(page, 'scientist', '/compounds/search');
  await page.getByLabel(/Substructure/).fill('c1ccccc1NC(=O)');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/q=c1ccccc1NC/);
  const table = page.getByRole('table', { name: 'Structure search results' });
  await expect(table.getByRole('link', { name: 'CPD-000001' })).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole('img', { name: /Structure of CPD-000001/ })).toBeVisible();
  await expect(table.getByRole('link', { name: 'CPD-000003' })).toHaveCount(0); // a sulfonamide, no anilide
  await page.screenshot({ path: `${SHOTS}/substructure-search.png`, fullPage: true });

  await page.getByLabel('Search for').selectOption('similarity');
  await page.getByLabel(/Similar to/).fill('Cc1ccc(NC(=O)c2ccccc2)cc1');
  await page.getByLabel('Tanimoto at least').fill('0.3');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(table.getByRole('row').nth(1)).toContainText('1.000');

  await table.getByRole('link', { name: 'CPD-000001' }).click();
  const structure = page.getByRole('region', { name: 'Structure' });
  await expect(structure.getByRole('img', { name: /Structure of CPD-000001/ })).toBeVisible();
  await expect(structure).toContainText('YUIHXKGKVSVIEL-UHFFFAOYSA-N');
  await expect(structure).toContainText('g/mol');
  await page.screenshot({ path: `${SHOTS}/compound-structure.png`, fullPage: true });
});
