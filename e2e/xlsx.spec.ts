import { expect, test, type Page } from '@playwright/test';
import { apiCall, signIn, uniqueName } from './helpers.ts';

const SHOTS = 'artifacts/phase-32';

async function draft(page: Page, rows: Record<string, string>[] = []) {
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name: uniqueName('XLS'),
  });
  if (rows.length)
    await apiCall(page, 'PUT', `/v1/versions/${created.body.versions[0]!.id}/samples`, { rows });
  return created.body.id;
}

const rows = Array.from({ length: 12 }, (_, i) => ({
  sample_key: `X${String(i + 1).padStart(2, '0')}`,
  source_name: `culture ${i + 1}`,
  organism: 'Homo sapiens',
  compound_id: i < 6 ? 'vehicle' : 'CPD-000001',
  dose: i < 6 ? 'not applicable' : '1 µM',
  time: '24 h',
  well: `A${String(i + 1).padStart(2, '0')}`,
  raw_file: `run${i + 1}.raw`,
}));

test('XLS-01: download a manifest as Excel, upload the workbook into another draft, apply and save', async ({
  page,
}, info) => {
  await signIn(page, 'scientist');
  const source = await draft(page, rows);
  await page.goto(`/experiments/${source}`);
  await page.getByRole('tab', { name: 'Samples' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Excel' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  const path = info.outputPath('samples.xlsx');
  await download.saveAs(path);

  const target = await draft(page);
  await page.goto(`/experiments/${target}`);
  await page.getByRole('tab', { name: 'Samples' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByLabel('Manifest file').setInputFiles(path);
  const preview = page.getByRole('region', { name: 'Upload preview' });
  await expect(preview.getByText('12 rows')).toBeVisible();
  await expect(preview.getByText('Delimiter: Excel workbook')).toBeVisible();
  await expect(preview).toContainText('1 µM');
  await page.screenshot({ path: `${SHOTS}/xlsx-preview.png`, fullPage: true });
  await preview.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('No problems')).toBeVisible();
  await page.getByRole('button', { name: 'Save samples' }).click();
  await expect(page.getByText('12 samples saved')).toBeVisible();
});
