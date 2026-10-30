import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiCall, signIn, uniqueName } from './helpers.ts';

// Needs the local stack, `pnpm db:migrate`, `pnpm db:seed` (adds the "demo" pipeline) and Docker for the local runner.
const SHOTS = 'artifacts/phase-11';
const FIXTURES = resolve(import.meta.dirname, '../fixtures/experiments/ONC-DIA-05');
const CONTRAST = { numerator: 'CPD-000005@1 µM', denominator: 'DMSO', label: 'CPD-000005@1 µM vs DMSO' };

function manifestRows(): Record<string, string>[] {
  const [header, ...lines] = readFileSync(`${FIXTURES}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
}

async function publishedExperiment(
  page: Page,
  name: string,
  brokenFile = false,
): Promise<{ id: string; version: string }> {
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name,
  });
  const version = created.body.versions[0]!.id;
  await apiCall(page, 'PUT', `/v1/versions/${version}/samples`, { rows: manifestRows() });
  await apiCall(page, 'PUT', `/v1/versions/${version}/contrasts`, { contrasts: [CONTRAST] });
  if (brokenFile) {
    await page.goto(`/experiments/${created.body.id}`);
    await page.getByRole('tab', { name: 'Files' }).click();
    await page
      .getByLabel('Choose files')
      .setInputFiles({ name: 'broken.tsv', mimeType: 'text/plain', buffer: Buffer.alloc(3000) });
    await page.getByRole('button', { name: 'Upload 1 file' }).click();
    await expect(page.getByRole('table', { name: 'Files' }).getByText('QC failed')).toBeVisible({
      timeout: 30_000,
    });
  }
  const published = await apiCall(page, 'POST', `/v1/versions/${version}/publish`, {
    reason: 'ready for analysis',
  });
  expect(published.status).toBe(200);
  return { id: created.body.id, version };
}

test('PIPE-05: launch the demo pipeline from the list; status updates without refresh; run page shows logs and outputs; results flag', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, 'scientist');
  const name = uniqueName('PIPE');
  const experiment = await publishedExperiment(page, name);

  await page.goto(`/experiments?name=${encodeURIComponent(name)}`);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await row.getByRole('button', { name: 'Launch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch pipeline' });
  await expect(dialog.getByLabel('Pipeline')).toHaveValue(/.+/);
  await expect(dialog.getByRole('region', { name: 'QC gate' })).toContainText('Launch allowed');
  await page.screenshot({ path: `${SHOTS}/launch-dialog.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Launch' }).click();

  // The list updates by itself (no reload) until the run finishes and results exist.
  await expect(row.getByText('Succeeded')).toBeVisible({ timeout: 150_000 });
  await expect(row.getByText('Results')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/list-succeeded.png`, fullPage: true });

  await row.getByRole('link', { name: 'Succeeded' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Demo');
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText(/running/i);
  await expect(page.getByRole('region', { name: 'Recent log lines' })).toContainText('N E X T F L O W');
  const outputs = page.getByRole('table', { name: 'Outputs' });
  await expect(outputs).toContainText('report.pg_matrix.tsv');
  await expect(outputs).toContainText('toptable.tsv');
  await expect(outputs.getByRole('link', { name: /published/i })).toHaveCount(2);
  await page.screenshot({ path: `${SHOTS}/run-page.png`, fullPage: true });
  void experiment;
});

test('PIPE-05: launch is disabled with the QC reason until an approver overrides; then it works', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signIn(page, 'scientist');
  const name = uniqueName('PIPE-QC');
  const experiment = await publishedExperiment(page, name, true);

  await page.goto(`/experiments/${experiment.id}`);
  await page.getByRole('button', { name: 'Launch pipeline' }).click();
  let dialog = page.getByRole('dialog', { name: 'Launch pipeline' });
  const gate = dialog.getByRole('region', { name: 'QC gate' });
  await expect(gate).toContainText('Launch blocked');
  await expect(gate).toContainText('broken.tsv');
  await expect(dialog.getByRole('button', { name: 'Launch' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/launch-blocked.png`, fullPage: true });

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, 'admin', `/experiments/${experiment.id}`);
  await admin.getByRole('button', { name: 'Launch pipeline' }).click();
  const adminDialog = admin.getByRole('dialog', { name: 'Launch pipeline' });
  await adminDialog.getByRole('button', { name: 'Override QC' }).click();
  const override = admin.getByRole('dialog', { name: 'Override failed QC' });
  await override.getByLabel('Reason').fill('Placeholder file, not an input of this pipeline');
  await override.getByRole('button', { name: 'Override' }).click();
  await expect(adminDialog.getByRole('region', { name: 'QC gate' })).toContainText('Launch allowed');
  await adminContext.close();

  await page.reload();
  await page.getByRole('button', { name: 'Launch pipeline' }).click();
  dialog = page.getByRole('dialog', { name: 'Launch pipeline' });
  await expect(dialog.getByRole('region', { name: 'QC gate' })).toContainText('Launch allowed');
  await dialog.getByRole('button', { name: 'Launch' }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await expect(page.getByRole('region', { name: 'Run' })).toContainText(
    /Submitted|Pending|Running|Succeeded/,
  );
});

test('PIPE-06: admin adds a pipeline from an nf-schema file with a form preview; run page cancel and re-run with edits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, 'admin', '/admin/pipelines');
  const key = `e2e-${Date.now().toString(36)}`;
  await page.getByLabel('Key').fill(key);
  await page.getByLabel('Name', { exact: true }).fill(`E2E ${key}`);
  await page.getByLabel('Repository').fill('pipelines/demo');
  await page.getByLabel('Revision').fill('local');
  await page.getByLabel('Parameter schema (nf-schema JSON)').setInputFiles({
    name: 'nextflow_schema.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        $defs: {
          io: {
            title: 'Inputs',
            required: ['pg_matrix', 'toptable'],
            properties: {
              pg_matrix: {
                type: 'string',
                description: 'DIA-NN matrix path',
                default: '/fixtures/experiments/ONC-DIA-05/report.pg_matrix.tsv',
              },
              toptable: {
                type: 'string',
                description: 'limma table path',
                default: '/fixtures/experiments/ONC-DIA-05/toptable.tsv',
              },
              fdr: { type: 'number', minimum: 0, maximum: 1, default: 0.01 },
              // Keeps the run going long enough to cancel it from the run page.
              delay_seconds: { type: 'integer', minimum: 0, default: 120 },
            },
          },
        },
        allOf: [{ $ref: '#/$defs/io' }],
      }),
    ),
  });
  const preview = page.getByRole('region', { name: 'Form preview' });
  await expect(preview.getByLabel('pg_matrix')).toHaveValue(
    '/fixtures/experiments/ONC-DIA-05/report.pg_matrix.tsv',
  );
  await expect(preview.getByLabel('fdr')).toHaveValue('0.01');
  await page.screenshot({ path: `${SHOTS}/admin-pipeline.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save pipeline' }).click();
  await expect(page.getByRole('table', { name: 'Pipelines' })).toContainText(`E2E ${key}`);

  // Launch it, cancel from the run page, then re-run with an edited parameter.
  const name = uniqueName('PIPE-06');
  const experiment = await publishedExperiment(page, name);
  await page.goto(`/experiments/${experiment.id}`);
  await page.getByRole('button', { name: 'Launch pipeline' }).click();
  const dialog = page.getByRole('dialog', { name: 'Launch pipeline' });
  await dialog.getByLabel('Pipeline').selectOption({ label: `E2E ${key}` });
  await dialog.getByLabel('fdr').fill('2');
  await expect(dialog.getByText(/fdr.*(≤|at most|1)/i)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Launch' })).toBeDisabled();
  await dialog.getByLabel('fdr').fill('0.05');
  await dialog.getByRole('button', { name: 'Launch' }).click();
  await expect(page).toHaveURL(/\/runs\//);
  await page.getByRole('button', { name: 'Cancel run' }).click();
  await page.getByRole('dialog', { name: 'Cancel run' }).getByRole('button', { name: 'Cancel run' }).click();
  await expect(page.getByRole('region', { name: 'Run' })).toContainText('Cancelled', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Re-run with edits' }).click();
  const rerun = page.getByRole('dialog', { name: 'Launch pipeline' });
  await expect(rerun.getByLabel('fdr')).toHaveValue('0.05');
  await page.screenshot({ path: `${SHOTS}/rerun.png`, fullPage: true });
});
