import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiCall, signIn, uniqueName } from './helpers.ts';

// Needs the local stack, `pnpm db:migrate`, `pnpm db:seed`; Playwright also starts apps/compute (SDRF).
const SHOTS = 'artifacts/phase-6';
type Row = Record<string, string>;

async function draft(
  page: Page,
  rows: Row[] = [],
  extra: Record<string, unknown> = {},
): Promise<{ experiment: string; version: string }> {
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name: uniqueName('MAN'),
    ...extra,
  });
  const version = created.body.versions[0]!.id;
  if (rows.length) await apiCall(page, 'PUT', `/v1/versions/${version}/samples`, { rows });
  return { experiment: created.body.id, version };
}

async function openSamples(page: Page, ids: { experiment: string }) {
  await page.goto(`/experiments/${ids.experiment}`);
  await page.getByRole('tab', { name: 'Samples' }).click();
  await expect(page.getByRole('grid')).toBeVisible();
}

const cell = (page: Page, rowText: string, column: string): Locator =>
  page
    .locator('.ag-row', { hasText: rowText })
    .locator(`.ag-cell[col-id="${column}"]`);

async function editCell(target: Locator, value: string) {
  await target.dblclick();
  const input = target.locator('input');
  await input.fill(value);
  await input.press('Enter');
}

const sample = (i: number): Row => ({
  sample_key: `S${String(i).padStart(3, '0')}`,
  source_name: `source ${i}`,
  organism: 'Homo sapiens',
  compound_id: i % 12 === 1 ? 'vehicle' : 'CPD-000001',
  dose: i % 12 === 1 ? 'not applicable' : '1 µM',
  time: '24 h',
  well: `${'ABCDEFGH'[Math.floor((i - 1) / 12)]}${String(((i - 1) % 12) + 1).padStart(2, '0')}`,
  raw_file: `run${i}.raw`,
});
const toTsv = (rows: Row[]) => {
  const header = Object.keys(rows[0]!);
  return [header.join('\t'), ...rows.map((r) => header.map((h) => r[h] ?? '').join('\t'))].join('\n');
};

test('MAN-01: SPEC M2 check — 96-row TSV with 5 errors is parsed, each error shows on its cell, inline fixes, publish', async ({
  page,
}) => {
  await signIn(page, 'scientist');
  const ids = await draft(page);
  await openSamples(page, ids);

  const rows = Array.from({ length: 96 }, (_, i) => sample(i + 1));
  rows[4]!.well = 'Z99'; // bad well
  rows[10]!.organism = 'Homo sapien'; // unknown species
  rows[20]!.dose = '10'; // dose without unit
  rows[30]!.sample_key = 'S001'; // duplicate key
  rows[40]!.source_name = ''; // missing required field

  await page.getByLabel('Manifest file').setInputFiles({
    name: 'manifest.tsv',
    mimeType: 'text/tab-separated-values',
    buffer: Buffer.from(toTsv(rows)),
  });
  const preview = page.getByRole('region', { name: 'Upload preview' });
  await expect(preview.getByText('96 rows')).toBeVisible();
  await expect(preview.getByText('Delimiter: tab')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/upload-preview.png` });
  await preview.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByText('5 problems')).toBeVisible();
  await page.getByLabel('Only rows with problems').check();
  await page.screenshot({ path: `${SHOTS}/problems.png` });
  for (const [row, column] of [
    ['S005', 'well'],
    ['S011', 'organism'],
    ['S021', 'dose'],
    ['source 31', 'sample_key'],
    ['S041', 'source_name'],
  ] as const) {
    await expect(cell(page, row, column)).toHaveClass(/cell-invalid/);
  }

  await editCell(cell(page, 'S005', 'well'), 'E05');
  await cell(page, 'S011', 'organism').dblclick();
  await page.getByRole('combobox', { name: 'organism' }).fill('Homo sap');
  await page.getByRole('option', { name: 'Homo sapiens' }).click();
  await editCell(cell(page, 'S021', 'dose'), '10 µM');
  await editCell(cell(page, 'source 31', 'sample_key'), 'S031');
  await editCell(cell(page, 'S041', 'source_name'), 'source 41');

  await expect(page.getByText('No problems')).toBeVisible();
  await page.getByLabel('Only rows with problems').uncheck();
  await page.getByRole('button', { name: 'Save samples' }).click();
  await expect(page.getByText('96 samples saved')).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish version 1' });
  await dialog.getByLabel('Reason').fill('Manifest fixed inline');
  await dialog.getByRole('button', { name: 'Publish version' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/published.png` });
});

test('MAN-02: add, edit and delete rows; sample-level custom column with searchable flag; quantity cells normalise', async ({
  page,
}) => {
  await signIn(page, 'scientist');
  const ids = await draft(page, [sample(1), sample(2)]);
  await openSamples(page, ids);

  await page.getByRole('button', { name: 'Add column' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add sample column' });
  await dialog.getByLabel('Key').fill('passage');
  await dialog.getByLabel('Type').selectOption('integer');
  await dialog.getByLabel('Searchable').check();
  await dialog.getByRole('button', { name: 'Add column' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'passage (searchable)' })).toBeVisible();

  await page.getByRole('button', { name: 'Add row' }).click();
  const fresh = page.locator('.ag-row').last();
  await editCell(fresh.locator('.ag-cell[col-id="sample_key"]'), 'NEW1');
  await editCell(cell(page, 'NEW1', 'source_name'), 'new culture');
  await cell(page, 'NEW1', 'organism').dblclick();
  await page.getByRole('combobox', { name: 'organism' }).fill('Homo');
  await page.getByRole('option', { name: 'Homo sapiens' }).click();
  await editCell(cell(page, 'NEW1', 'dose'), '1000 nM');
  await expect(cell(page, 'NEW1', 'dose')).toContainText('1e-6 M');
  await editCell(cell(page, 'NEW1', 'passage'), '7');

  await cell(page, 'S002', 'sample_key').click();
  await page.getByRole('button', { name: 'Delete row' }).click();
  await expect(page.locator('.ag-row', { hasText: 'S002' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Save samples' }).click();
  await expect(page.getByText('2 samples saved')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Samples' }).click();
  await expect(cell(page, 'NEW1', 'passage')).toHaveText('7');
  await expect(page.locator('.ag-row', { hasText: 'S002' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'passage (searchable)' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/custom-column.png` });
});

test('MAN-03: Paste TSV block dialog maps columns, saves a preset, and applies 20 rows', async ({ page }) => {
  await signIn(page, 'scientist');
  const ids = await draft(page);
  await openSamples(page, ids);
  const block = [
    ['Sample ID', 'Species', 'Position', 'Origin'].join('\t'),
    ...Array.from({ length: 20 }, (_, i) =>
      [`P${i + 1}`, 'Homo sapiens', `B${String(i + 1).padStart(2, '0')}`.slice(0, 3), `origin ${i + 1}`].join(
        '\t',
      ),
    ),
  ].join('\n');

  await page.getByRole('button', { name: 'Paste TSV block' }).click();
  const dialog = page.getByRole('dialog', { name: 'Paste TSV block' });
  await dialog.getByLabel('TSV block').fill(block);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Map “Sample ID”').selectOption('sample_key');
  await dialog.getByLabel('Map “Species”').selectOption('organism');
  await dialog.getByLabel('Map “Position”').selectOption('well');
  await dialog.getByLabel('Map “Origin”').selectOption('source_name');
  await dialog.getByLabel('Save mapping as preset').fill('Core facility export');
  await page.screenshot({ path: `${SHOTS}/paste-mapping.png` });
  await dialog.getByRole('button', { name: 'Apply 20 rows' }).click();
  await expect(page.getByText('20 rows')).toBeVisible();
  await expect(cell(page, 'P20', 'source_name')).toHaveText('origin 20');

  // The preset is offered next time.
  await page.getByRole('button', { name: 'Paste TSV block' }).click();
  await dialog.getByLabel('TSV block').fill(block);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel('Mapping preset').selectOption({ label: 'Core facility export' });
  await expect(dialog.getByLabel('Map “Species”')).toHaveValue('organism');
});

test('MAN-05: plate layout coloured by a factor; click a well to select its sample; contrasts editor', async ({
  page,
}) => {
  await signIn(page, 'scientist');
  const rows = [sample(1), sample(2), sample(14)].map((r, i) => ({
    ...r,
    condition: i === 0 ? 'DMSO' : 'CPD-000001@1 µM',
  }));
  const ids = await draft(page, rows);
  await openSamples(page, ids);

  await page.getByRole('button', { name: 'Plate layout' }).click();
  const plate = page.getByRole('region', { name: 'Plate layout' });
  await plate.getByLabel('Colour by').selectOption('condition');
  await expect(plate.getByRole('button', { name: 'Well A01: S001 (DMSO)' })).toBeVisible();
  await expect(plate.getByRole('button', { name: 'Well B02: S014 (CPD-000001@1 µM)' })).toBeVisible();
  await expect(plate.getByRole('list', { name: 'Legend' })).toContainText('DMSO');
  await plate.getByRole('button', { name: /Well A02/ }).click();
  await expect(plate.getByText('Selected: S002')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/plate.png` });

  await page.getByRole('tab', { name: 'Contrasts' }).click();
  await page.getByLabel('Numerator').selectOption('CPD-000001@1 µM');
  await page.getByLabel('Denominator').selectOption('DMSO');
  await page.getByRole('button', { name: 'Add contrast' }).click();
  await page.getByRole('button', { name: 'Save contrasts' }).click();
  await expect(page.getByText('Contrasts saved')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Contrasts' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'CPD-000001@1 µM vs DMSO' })).toBeVisible();
});

test('MAN-06: SDRF export downloads a validated file; SDRF import adds rows', async ({ page }) => {
  await signIn(page, 'scientist');
  // SDRF requires the instrument; it comes from the experiment-level `instrument` custom field.
  const ids = await draft(page, [sample(1), sample(2)], {
    custom_fields: [
      {
        scope: 'experiment',
        key: 'instrument',
        label: 'Instrument',
        type: 'text',
        required: false,
        searchable: true,
      },
    ],
    custom: { instrument: 'NT=Orbitrap Exploris 480;AC=MS:1003028' },
  });
  await openSamples(page, ids);

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SDRF' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.sdrf\.tsv$/);
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(chunk as Buffer);
  const sdrf = Buffer.concat(chunks).toString('utf8');
  expect(sdrf.split('\n')[0]!.split('\t')[0]).toBe('source name');
  expect(sdrf).toContain('run2.raw');

  const imported = sdrf.replaceAll('S002', 'S099').replaceAll('run2.raw', 'run99.raw');
  await page.getByLabel('Import SDRF').setInputFiles({
    name: 'import.sdrf.tsv',
    mimeType: 'text/tab-separated-values',
    buffer: Buffer.from(imported),
  });
  await expect(page.getByText('3 samples saved')).toBeVisible();
  await expect(cell(page, 'S099', 'raw_file')).toHaveText('run99.raw');
});
