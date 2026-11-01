import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiCall } from './helpers.ts';

// Shared e2e data setup through the API.
const FIXTURES = resolve(import.meta.dirname, '../fixtures/experiments/ONC-DIA-05');
export const CURVE_OPTIONS = {
  compound_id: 'CPD-000001',
  doses: [0, 1, 10, 100, 1000, 10000],
  dose_scale: 1e-9,
  dose_unit: 'M',
};
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

export interface Upload {
  /** Path under fixtures/ (experiments/ONC-DIA-05 by default), or the file name when `buffer` is given. */
  file: string;
  /** Without an importer the file is only uploaded (e.g. raw files). */
  importer?: string;
  /** File content instead of a fixture path. */
  buffer?: Buffer;
  role?: 'raw' | 'processed';
  /** Leave the imported release staged (default: publish it). */
  publish?: boolean;
  contrast?: boolean;
  options?: Record<string, unknown>;
  dataset?: string;
}

async function upload(page: Page, version: string, what: Upload): Promise<string> {
  const path = what.file.includes('/') ? resolve(FIXTURES, '../..', what.file) : `${FIXTURES}/${what.file}`;
  const bytes = what.buffer ? new Uint8Array(what.buffer) : readFileSync(path);
  const started = await apiCall<{ file: { id: string }; parts: { url: string }[] }>(
    page,
    'POST',
    '/v1/files/uploads',
    {
      experiment_version_id: version,
      name: path.split('/').pop(),
      size_bytes: bytes.length,
      role: what.role ?? 'processed',
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
  return started.body.file.id;
}

/** A published ONC experiment (ONC-DIA-05 manifest + contrast); returns ids. */
export async function publishedExperiment(page: Page, name: string, files: Upload[] = []) {
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
  const fileIds = [];
  for (const f of files) fileIds.push(await upload(page, version, f));
  expect((await apiCall(page, 'POST', `/v1/versions/${version}/publish`, { reason: 'ready' })).status).toBe(
    200,
  );
  const releases: string[] = [];
  for (const [i, f] of files.entries()) {
    if (!f.importer) continue;
    const imported = await apiCall<{ id: string }>(page, 'POST', '/v1/imports', {
      file_id: fileIds[i],
      importer: f.importer,
      dataset_name: f.dataset ?? name,
      ...(f.contrast ? { contrast_id: contrasts.body.items[0]!.id } : {}),
      ...(f.options ? { options: f.options } : {}),
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(201);
    releases.push(imported.body.id);
    if (f.publish === false) continue;
    expect(
      (await apiCall(page, 'POST', `/v1/releases/${imported.body.id}/publish`, { reason: 'checked' })).status,
    ).toBe(200);
  }
  return { experiment: created.body.id, version, releases, contrast: contrasts.body.items[0]!.id };
}

async function publishedRelease(
  page: Page,
  name: string,
  what: Upload,
): Promise<{ version: string; release: string }> {
  const made = await publishedExperiment(page, name, [what]);
  return { version: made.version, release: made.releases[0]! };
}

/** Launches the seeded demo pipeline on a new published experiment and waits for its outputs to be published. */
export async function demoRun(page: Page, name: string, files: Upload[] = []) {
  const made = await publishedExperiment(page, name, files);
  const pipelines = await apiCall<{ items: { id: string; key: string }[] }>(page, 'GET', '/v1/pipelines');
  const run = await apiCall<{ id: string }>(page, 'POST', '/v1/runs', {
    pipeline_definition_id: pipelines.body.items.find((p) => p.key === 'demo')!.id,
    experiment_version_id: made.version,
    runner: 'local',
    params: {},
  });
  expect(run.status, JSON.stringify(run.body)).toBe(201);
  await expect
    .poll(
      async () => {
        const r = (
          await apiCall<{ status: string; outputs: { release_status: string | null }[] }>(
            page,
            'GET',
            `/v1/runs/${run.body.id}`,
          )
        ).body;
        return (
          r.status === 'succeeded' &&
          r.outputs.length > 0 &&
          r.outputs.every((o) => o.release_status === 'published')
        );
      },
      { timeout: 150_000, intervals: [2000] },
    )
    .toBe(true);
  return { ...made, run: run.body.id };
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
