import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiCall } from './helpers.ts';

// Shared e2e data setup through the API.
const FIXTURES = resolve(import.meta.dirname, '../fixtures/experiments/ONC-DIA-05');
export const CONTRAST = {
  numerator: 'CPD-000005@1 µM',
  denominator: 'DMSO',
  label: 'CPD-000005@1 µM vs DMSO',
};

function manifestRows(): Record<string, string>[] {
  const [header, ...lines] = readFileSync(`${FIXTURES}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
}

/** A published ONC experiment with a published limma differential-abundance release (via the API). */
export const daRelease = (page: Page, name: string) =>
  publishedRelease(page, name, { file: 'toptable.tsv', importer: 'limma_toptable', contrast: true });

/** The same, with the DIA-NN protein-group matrix imported as a protein_quant release (one row per protein × run). */
export const pqRelease = (page: Page, name: string) =>
  publishedRelease(page, name, {
    file: 'report.pg_matrix.tsv',
    importer: 'diann_pg_matrix',
    contrast: false,
  });

async function publishedRelease(
  page: Page,
  name: string,
  what: { file: string; importer: string; contrast: boolean },
): Promise<{ version: string; release: string }> {
  const programs = await apiCall<{ items: { id: string; code: string }[] }>(page, 'GET', '/v1/programs');
  const created = await apiCall<{ id: string; versions: { id: string }[] }>(page, 'POST', '/v1/experiments', {
    program_id: programs.body.items.find((p) => p.code === 'ONC')!.id,
    assay_type: 'proteomics_dia',
    name,
  });
  const version = created.body.versions[0]!.id;
  await apiCall(page, 'PUT', `/v1/versions/${version}/samples`, { rows: manifestRows() });
  const contrasts = await apiCall<{ items: { id: string }[] }>(
    page,
    'PUT',
    `/v1/versions/${version}/contrasts`,
    {
      contrasts: [CONTRAST],
    },
  );
  const bytes = readFileSync(`${FIXTURES}/${what.file}`);
  const started = await apiCall<{ file: { id: string }; parts: { url: string }[] }>(
    page,
    'POST',
    '/v1/files/uploads',
    {
      experiment_version_id: version,
      name: what.file,
      size_bytes: bytes.length,
      role: 'processed',
    },
  );
  const put = await fetch(started.body.parts[0]!.url, { method: 'PUT', body: bytes });
  await apiCall(page, 'POST', `/v1/files/${started.body.file.id}/complete`, {
    parts: [{ part_number: 1, etag: put.headers.get('etag') }],
  });
  await expect
    .poll(
      async () =>
        (await apiCall<{ ingest_status: string }>(page, 'GET', `/v1/files/${started.body.file.id}`)).body
          .ingest_status,
      {
        timeout: 30_000,
      },
    )
    .toBe('qc_passed');
  expect((await apiCall(page, 'POST', `/v1/versions/${version}/publish`, { reason: 'ready' })).status).toBe(
    200,
  );
  const imported = await apiCall<{ id: string }>(page, 'POST', '/v1/imports', {
    file_id: started.body.file.id,
    importer: what.importer,
    dataset_name: name,
    ...(what.contrast ? { contrast_id: contrasts.body.items[0]!.id } : {}),
  });
  expect(imported.status).toBe(201);
  const release = imported.body.id;
  expect((await apiCall(page, 'POST', `/v1/releases/${release}/publish`, { reason: 'checked' })).status).toBe(
    200,
  );
  return { version, release };
}

export async function pickRelease(page: Page, name: string) {
  const picker = page.getByRole('region', { name: 'Dataset' });
  await picker.getByLabel('Dataset kind').selectOption('differential_abundance');
  const release = picker.getByLabel('Release');
  const label = await release.locator('option', { hasText: name }).textContent();
  await release.selectOption({ label: label! });
}

export async function addRule(
  page: Page,
  scope: ReturnType<Page['getByRole']>,
  field: string,
  operator: string,
  value: string,
) {
  await scope.getByRole('button', { name: '+ Rule' }).first().click();
  const rule = scope.locator('.rule').last();
  await rule.getByTitle('Fields').selectOption(field);
  await rule.getByTitle('Operators').selectOption(operator);
  await rule.getByTitle('Value').fill(value);
}
