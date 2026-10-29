import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCall, signIn, uniqueName } from './helpers.ts';

// Needs the local stack, `pnpm db:migrate` and `pnpm db:seed` (programs ONC and IMM).
const SHOTS = 'artifacts/phase-5';
const tsv = (rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');
const HEADER = ['sample_key', 'source_name', 'organism', 'compound_id', 'dose', 'time', 'well'];

async function pasteSamples(page: Page, rows: string[][]) {
  await page.getByRole('tab', { name: 'Samples' }).click();
  await page.getByLabel('Paste TSV').fill(tsv([HEADER, ...rows]));
  await page.getByRole('button', { name: 'Save samples' }).click();
  await expect(page.getByText(`${rows.length} samples saved`)).toBeVisible();
}

test('REG-07: create with custom fields, add samples, publish with a reason, create version 2', async ({
  page,
}) => {
  const name = uniqueName('REG-07 dose series');
  await signIn(page, 'scientist', '/experiments');
  await expect(page.getByRole('heading', { name: 'Experiments' })).toBeVisible();
  await page.getByRole('link', { name: 'New experiment' }).click();

  // Wizard step 1: details
  await page.getByLabel('Program').selectOption({ label: 'ONC — Oncology demo' });
  await page.getByLabel('Assay type').selectOption({ label: 'Proteomics (DIA)' });
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Experiment date').fill('2026-10-01');
  await page.getByLabel('Time points').fill('6 h, 24 h');
  await page.screenshot({ path: `${SHOTS}/wizard-details.png` });
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 2: three custom fields, one searchable
  const fields = [
    ['operator', 'Operator', 'text', 'Lab A', true],
    ['instrument', 'Instrument', 'text', 'Orbitrap 1', false],
    ['gradient_min', 'Gradient (min)', 'integer', '45', false],
  ] as const;
  for (const [i, [key, label, type, value, searchable]] of fields.entries()) {
    await page.getByRole('button', { name: 'Add field' }).click();
    const row = page.getByRole('group', { name: `Custom field ${i + 1}` });
    await row.getByLabel('Key').fill(key);
    await row.getByLabel('Label').fill(label);
    await row.getByLabel('Type').selectOption(type);
    await row.getByLabel('Value').fill(value);
    if (searchable) await row.getByLabel('Searchable').check();
  }
  await page.screenshot({ path: `${SHOTS}/wizard-custom-fields.png` });
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 3: review and create
  await expect(page.getByText('operator (searchable)')).toBeVisible();
  await page.getByRole('button', { name: 'Create experiment' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Draft' })).toBeVisible();

  await pasteSamples(page, [
    ['S1', 'culture 1', 'Homo sapiens', 'CPD-000001', '1 µM', '24 h', 'A01'],
    ['S2', 'culture 2', 'Homo sapiens', 'CPD-000001', '1 µM', '24 h', 'A02'],
    ['S3', 'culture 3', 'Homo sapiens', 'vehicle', 'not applicable', '24 h', 'A03'],
  ]);
  await expect(page.getByRole('row', { name: /S3/ })).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish version 1' });
  await expect(dialog.getByRole('button', { name: 'Publish version' })).toBeDisabled();
  await dialog.getByLabel('Reason').fill('First complete manifest');
  await page.screenshot({ path: `${SHOTS}/publish-dialog.png` });
  await dialog.getByRole('button', { name: 'Publish version' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Published' })).toBeVisible();

  await page.getByRole('button', { name: 'Create version' }).click();
  await expect(page.getByRole('heading', { name: 'Version 2' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Draft' })).toBeVisible();

  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.getByRole('row', { name: /v1.*Published.*First complete manifest/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /v2.*Draft/ })).toBeVisible();

  // The list shows the experiment with its current version and latest published version.
  await page.getByRole('link', { name: 'Experiments' }).click();
  await page.getByLabel('Name contains').fill(name);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('v2');
  await expect(row).toContainText('Draft');
  await expect(row.getByRole('button', { name: 'Launch pipeline' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/experiments-list.png` });
});

test('REG-08: diff shows exactly the changed fields and samples; v1 stays immutable', async ({ page }) => {
  await signIn(page, 'scientist', '/experiments');
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const onc = programs.body.items.find((p) => p.code === 'ONC')!;
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: onc.id,
    assay_type: 'proteomics_dia',
    name: uniqueName('REG-08 diff'),
    description: 'baseline',
  });
  const v1 = created.body.versions[0]!.id;
  const row = (key: string, dose: string, well: string) => ({
    sample_key: key,
    source_name: key,
    organism: 'Homo sapiens',
    compound_id: 'CPD-000001',
    dose,
    time: '24 h',
    well,
  });
  await apiCall(page, 'PUT', `/v1/versions/${v1}/samples`, {
    rows: [row('S1', '1 µM', 'A01'), row('S2', '1 µM', 'A02'), row('S3', '1 µM', 'A03')],
  });
  expect((await apiCall(page, 'POST', `/v1/versions/${v1}/publish`, { reason: 'baseline' })).status).toBe(
    200,
  );
  const v2 = (await apiCall<{ id: string }>(page, 'POST', `/v1/versions/${v1}/clone`)).body.id;
  await apiCall(page, 'PATCH', `/v1/versions/${v2}`, { description: 'two samples changed' });
  await apiCall(page, 'PUT', `/v1/versions/${v2}/samples`, {
    rows: [row('S1', '10 µM', 'A01'), row('S2', '1 µM', 'B02')],
  });

  // v1 is immutable: an edit attempt returns 409.
  expect((await apiCall(page, 'PATCH', `/v1/versions/${v1}`, { description: 'sneaky' })).status).toBe(409);

  await page.goto(`/experiments/${created.body.id}?version=${v2}`);
  await page.getByRole('tab', { name: 'Versions' }).click();
  await page.getByLabel('Compare from').selectOption({ label: 'v1' });
  await page.getByLabel('Compare to').selectOption({ label: 'v2' });
  const diff = page.getByRole('region', { name: 'Differences' });
  await expect(diff.getByRole('row', { name: /description.*baseline.*two samples changed/ })).toBeVisible();
  await expect(diff.getByRole('row', { name: /S1.*dose.*1 µM.*10 µM/ })).toBeVisible();
  await expect(diff.getByRole('row', { name: /S2.*well.*A02.*B02/ })).toBeVisible();
  await expect(diff.getByText('2 samples changed')).toBeVisible();
  await expect(diff.getByText('No samples added or removed')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/diff.png`, fullPage: true });
});

test('REG-07: list and form pages have no serious or critical accessibility violations', async ({ page }) => {
  await signIn(page, 'scientist', '/experiments');
  for (const path of ['/experiments', '/experiments/new']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${path}: ${v.id} — ${v.help}`)).toEqual([]);
  }
});
