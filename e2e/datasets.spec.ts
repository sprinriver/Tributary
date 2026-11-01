import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiCall, signIn, uniqueName } from './helpers.ts';

// Needs the local stack, `pnpm db:migrate`, `pnpm db:seed`; Playwright also starts apps/query.
const SHOTS = 'artifacts/phase-8';
const FIXTURES = resolve(import.meta.dirname, '../fixtures/experiments/ONC-DIA-01');

function manifestRows(): Record<string, string>[] {
  const [header, ...lines] = readFileSync(`${FIXTURES}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
}

test('DS-05: import a DIA-NN matrix from the Files tab, publish the release, and find it in the dataset catalog', async ({
  page,
}) => {
  await signIn(page, 'scientist');
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const name = uniqueName('DS');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name,
  });
  const samples = await apiCall(page, 'PUT', `/v1/versions/${created.body.versions[0]!.id}/samples`, {
    rows: manifestRows(),
  });
  expect(samples.status).toBe(200);

  await page.goto(`/experiments/${created.body.id}`);
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.getByLabel('Choose files').setInputFiles(`${FIXTURES}/report.pg_matrix.tsv`);
  await page.getByLabel('Role').selectOption('processed');
  await page.getByRole('button', { name: 'Upload 1 file' }).click();
  const row = page.getByRole('table', { name: 'Files' }).getByRole('row', { name: /report\.pg_matrix\.tsv/ });
  await expect(row.getByText('QC passed')).toBeVisible({ timeout: 30_000 });

  await row.getByRole('button', { name: 'Import…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import dataset' });
  await expect(dialog.getByLabel('Importer')).toHaveValue('diann_pg_matrix');
  await dialog.getByRole('button', { name: 'Import' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText('protein_quant');
  const status = page.getByRole('region', { name: 'Release' });
  await expect(status).toContainText('Staged');
  await expect(status).toContainText(/\d+ rows/);
  await expect(page.getByRole('table', { name: 'Schema' })).toContainText('log2_intensity');
  await expect(page.getByRole('table', { name: 'Column statistics' })).toContainText('intensity');
  await expect(page.getByRole('region', { name: 'Quality rules' })).toContainText('intensity_non_negative');
  await page.screenshot({ path: `${SHOTS}/release-staged.png`, fullPage: true });

  await page.getByRole('button', { name: 'Publish release' }).click();
  const publish = page.getByRole('dialog', { name: 'Publish release' });
  await publish.getByLabel('Reason').fill('Matrix checked against the run list');
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(status).toContainText('Published');
  await expect(page.getByRole('button', { name: 'Publish release' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Datasets' }).click();
  const catalog = page.getByRole('table', { name: 'Datasets' });
  const entry = catalog.getByRole('row', { name: new RegExp(name) });
  await expect(entry).toContainText('protein_quant');
  await expect(entry).toContainText('Published');
  await page.screenshot({ path: `${SHOTS}/catalog.png`, fullPage: true });
});
