import { expect, test, type Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { apiCall, signIn, uniqueName } from './helpers.ts';

// Needs the local stack (SeaweedFS with CORS for the web origin), `pnpm db:migrate`, `pnpm db:seed`.
const SHOTS = 'artifacts/phase-7';
const FASTQ = '@read1\nACGTACGT\n+\nIIIIIIII\n'.repeat(5000);

async function draft(page: Page): Promise<{ experiment: string; version: string }> {
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name: uniqueName('ING'),
  });
  return { experiment: created.body.id, version: created.body.versions[0]!.id };
}

test('ING-04: upload two files from the browser; statuses update; a corrupted gzip shows qc_failed with its reason; an approver override unblocks launch', async ({
  page,
  browser,
}) => {
  await signIn(page, 'scientist');
  const ids = await draft(page);
  await page.goto(`/experiments/${ids.experiment}`);
  await page.getByRole('tab', { name: 'Files' }).click();

  const good = gzipSync(FASTQ);
  const corrupted = Buffer.from(gzipSync(FASTQ));
  // Damage the middle of the deflate stream (repetitive FASTQ compresses to a few hundred bytes).
  const middle = Math.floor(corrupted.length / 2);
  for (let i = middle - 40; i < middle + 40; i++) corrupted[i] = corrupted[i]! ^ 0xff;
  await page.getByLabel('Choose files').setInputFiles([
    { name: 'good.fastq.gz', mimeType: 'application/gzip', buffer: good },
    { name: 'broken.fastq.gz', mimeType: 'application/gzip', buffer: corrupted },
  ]);
  await page.getByRole('button', { name: 'Upload 2 files' }).click();

  const files = page.getByRole('table', { name: 'Files' });
  const goodRow = files.getByRole('row', { name: /good\.fastq\.gz/ });
  const badRow = files.getByRole('row', { name: /broken\.fastq\.gz/ });
  await expect(goodRow.getByText('QC passed')).toBeVisible({ timeout: 30_000 });
  await expect(badRow.getByText('QC failed')).toBeVisible({ timeout: 30_000 });
  await expect(badRow).toContainText(/gzip/i);
  await expect(goodRow).toContainText('FASTQ (gzip)');

  const gate = page.getByRole('region', { name: 'Pipeline launch gate' });
  await expect(gate).toContainText(/Launch blocked/);
  await expect(gate).toContainText('broken.fastq.gz');
  // Scientists (contributors) cannot override.
  await expect(gate.getByRole('button', { name: 'Override QC' })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/files-qc-failed.png`, fullPage: true });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, 'admin', `/experiments/${ids.experiment}`);
  await adminPage.getByRole('tab', { name: 'Files' }).click();
  const adminGate = adminPage.getByRole('region', { name: 'Pipeline launch gate' });
  await adminGate.getByRole('button', { name: 'Override QC' }).click();
  const dialog = adminPage.getByRole('dialog', { name: 'Override failed QC' });
  await dialog.getByLabel('Reason').fill('Vendor export known to truncate; reviewed by approver');
  await dialog.getByRole('button', { name: 'Override' }).click();
  await expect(adminGate).toContainText(/Launch allowed/);
  await expect(adminGate).toContainText('Vendor export known to truncate');
  await adminPage.screenshot({ path: `${SHOTS}/files-qc-overridden.png`, fullPage: true });
  await adminContext.close();

  const gateApi = await apiCall<{ can_launch: boolean }>(page, 'GET', `/v1/versions/${ids.version}/qc-gate`);
  expect(gateApi.body.can_launch).toBe(true);
});
