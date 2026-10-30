import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/experiments/ONC-DIA-01');
const MATRIX = readFileSync(`${FIXTURES}/report.pg_matrix.tsv`);

function manifestRows(): Record<string, string>[] {
  const [header, ...lines] = readFileSync(`${FIXTURES}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
}

describe('dataset releases and catalog API', () => {
  let t: TestApi;
  let program: string;
  let contributor: string;
  let viewer: string;
  let outsider: string;
  let version: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('DSP');
    const other = await t.program('OTH');
    contributor = (await t.user('ds-contributor', { [program]: 'contributor' })).token;
    viewer = (await t.user('ds-viewer', { [program]: 'viewer' })).token;
    outsider = (await t.user('ds-outsider', { [other]: 'contributor' })).token;
    const res = await t.call(contributor, {
      method: 'POST',
      url: '/v1/experiments',
      payload: { program_id: program, assay_type: 'proteomics_dia', name: 'DS dose series' },
    });
    version = (res.json() as Json).versions[0].id;
    const samples = await t.call(contributor, {
      method: 'PUT',
      url: `/v1/versions/${version}/samples`,
      payload: { rows: manifestRows() },
    });
    expect(samples.statusCode, samples.body).toBe(200);
  }, 300_000);
  afterAll(() => t.close());

  async function upload(name: string, bytes: Uint8Array): Promise<string> {
    const started = (
      await t.call(contributor, {
        method: 'POST',
        url: '/v1/files/uploads',
        payload: { experiment_version_id: version, name, size_bytes: bytes.length, role: 'processed' },
      })
    ).json() as Json;
    const put = await fetch(started.parts[0].url, { method: 'PUT', body: bytes });
    const done = await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${started.file.id}/complete`,
      payload: { parts: [{ part_number: 1, etag: put.headers.get('etag') }] },
    });
    expect(done.statusCode, done.body).toBe(200);
    await t.drainIngest();
    return started.file.id as string;
  }

  const importFile = (token: string, payload: Json) =>
    t.call(token, { method: 'POST', url: '/v1/imports', payload, headers: { 'x-change-reason': 'pipeline output' } });

  let releaseId: string;

  it('DS-01: importing a QC-passed file creates a staged release with stats, contract and lineage', async () => {
    const file = await upload('report.pg_matrix.tsv', MATRIX);
    expect((await importFile(viewer, { file_id: file, importer: 'diann_pg_matrix' })).statusCode).toBe(403);
    const res = await importFile(contributor, { file_id: file, importer: 'diann_pg_matrix' });
    expect(res.statusCode, res.body).toBe(201);
    const release = res.json() as Json;
    expect(release).toMatchObject({ status: 'staged', release_number: 1, kind: 'protein_quant', importer: 'diann_pg_matrix' });
    expect(release.row_count).toBeGreaterThan(0);
    expect(release.validation.passed).toBe(true);
    expect(release.column_stats.intensity.null_count).toBeGreaterThan(0);
    expect(release.contract.columns.map((c: Json) => c.name)).toContain('log2_intensity');
    expect(release.lineage.inputs).toEqual([expect.objectContaining({ type: 'file', id: file })]);
    expect(release.source.original_columns[0]).toBe('Protein.Group');
    releaseId = release.id;
  });

  it('DS-01: publish requires a reason, is audited, and the published release is immutable', async () => {
    const noReason = await t.call(contributor, {
      method: 'POST',
      url: `/v1/releases/${releaseId}/publish`,
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    const res = await t.call(contributor, {
      method: 'POST',
      url: `/v1/releases/${releaseId}/publish`,
      payload: { reason: 'checked against the run log' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Json).status).toBe('published');
    const audit = await t.db
      .selectFrom('audit_log')
      .select('reason')
      .where('entity_id', '=', releaseId)
      .where('action', '=', 'release.publish')
      .executeTakeFirstOrThrow();
    expect(audit.reason).toBe('checked against the run log');

    const again = await t.call(contributor, {
      method: 'POST',
      url: `/v1/releases/${releaseId}/publish`,
      payload: { reason: 'twice' },
    });
    expect(again.statusCode).toBe(409);
    await expect(
      sql`update dataset_release set row_count = 1 where id = ${releaseId}`.execute(t.db),
    ).rejects.toMatchObject({ code: 'TR409' });
  });

  it('DS-01: DuckDB reads the published release (preview through apps/query)', async () => {
    const res = await t.call(viewer, { method: 'GET', url: `/v1/releases/${releaseId}/preview`, query: { limit: '3' } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.rows).toHaveLength(3);
    expect(body.row_count).toBeGreaterThan(3);
    expect(body.rows[0]).toHaveProperty('protein_group');
  });

  it('DS-01: a broken file is rejected with the failing rule named; it cannot be published', async () => {
    const broken = new TextEncoder().encode(MATRIX.toString('utf8').replace('\t4026427.8\t', '\t-7\t'));
    const file = await upload('broken.pg_matrix.tsv', broken);
    const res = await importFile(contributor, { file_id: file, importer: 'diann_pg_matrix', dataset_name: 'broken' });
    expect(res.statusCode, res.body).toBe(201);
    const release = res.json() as Json;
    expect(release.status).toBe('rejected');
    expect(release.validation.passed).toBe(false);
    expect(release.validation.failures.map((f: Json) => f.rule_id)).toContain('intensity_non_negative');
    const publish = await t.call(contributor, {
      method: 'POST',
      url: `/v1/releases/${release.id}/publish`,
      payload: { reason: 'try anyway' },
    });
    expect(publish.statusCode).toBe(409);
  });

  it('DS-01: files that failed QC cannot be imported', async () => {
    const bad = new Uint8Array(MATRIX.length).fill(0);
    bad.set(new TextEncoder().encode('x'), 0);
    const started = (
      await t.call(contributor, {
        method: 'POST',
        url: '/v1/files/uploads',
        payload: { experiment_version_id: version, name: 'bad.tsv', size_bytes: bad.length, declared_format: 'tsv' },
      })
    ).json() as Json;
    const put = await fetch(started.parts[0].url, { method: 'PUT', body: bad });
    await t.call(contributor, {
      method: 'POST',
      url: `/v1/files/${started.file.id}/complete`,
      payload: { parts: [{ part_number: 1, etag: put.headers.get('etag') }] },
    });
    await t.drainIngest();
    const res = await importFile(contributor, { file_id: started.file.id, importer: 'diann_pg_matrix' });
    expect(res.statusCode).toBe(422);
    expect((res.json() as Json).code).toBe('file_not_qc_passed');
  });

  it('DS-05: the catalog lists datasets with their latest release, scoped to readable programs', async () => {
    const res = await t.call(viewer, { method: 'GET', url: '/v1/datasets', query: { kind: 'protein_quant' } });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as Json).items as Json[];
    const dataset = items.find((d) => d.latest_release?.id === releaseId)!;
    expect(dataset).toMatchObject({ kind: 'protein_quant', program_code: 'DSP', experiment_version_id: version });
    expect(dataset.latest_release.status).toBe('published');
    const hidden = (await t.call(outsider, { method: 'GET', url: '/v1/datasets' })).json() as Json;
    expect(hidden.items).toEqual([]);
    const detail = await t.call(viewer, { method: 'GET', url: `/v1/datasets/${dataset.id}` });
    expect((detail.json() as Json).releases.map((r: Json) => r.id)).toContain(releaseId);
    expect((await t.call(outsider, { method: 'GET', url: `/v1/releases/${releaseId}` })).statusCode).toBe(403);
  });

  it('DS-05: ODCS YAML per kind and the importer list', async () => {
    const odcs = await t.call(viewer, { method: 'GET', url: '/v1/contracts/protein_quant/odcs' });
    expect(odcs.statusCode).toBe(200);
    expect(odcs.headers['content-type']).toMatch(/yaml/);
    expect(odcs.body).toMatch(/^apiVersion: v3\.0\.2$/m);
    expect(odcs.body).toMatch(/^kind: DataContract$/m);
    expect(odcs.body).toMatch(/name: log2_intensity/);
    expect(odcs.body).toMatch(/intensity_non_negative/);
    const importers = (await t.call(viewer, { method: 'GET', url: '/v1/importers' })).json() as Json;
    expect(importers.items.map((i: Json) => i.key)).toEqual(
      expect.arrayContaining(['diann_pg_matrix', 'limma_toptable', 'custom_tabular', 'reference_compound']),
    );
  });

  it('DS-04: custom_tabular mapping presets are saved per program', async () => {
    const created = await t.call(contributor, {
      method: 'POST',
      url: `/v1/programs/${program}/import-presets`,
      payload: {
        name: 'Vendor protein table',
        kind: 'protein_quant',
        columns: { protein_group: 'Accession', sample_key: 'Sample', instrument_run: 'Run', intensity: 'Abundance' },
        constants: { is_imputed: 'false' },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const list = (await t.call(viewer, { method: 'GET', url: `/v1/programs/${program}/import-presets` })).json() as Json;
    expect(list.items.map((p: Json) => p.name)).toEqual(['Vendor protein table']);

    const csv = new TextEncoder().encode('Accession,Sample,Run,Abundance\nP1,ONC-DIA-01-S01,r1,5\n');
    const file = await upload('vendor.csv', csv);
    const res = await importFile(contributor, {
      file_id: file,
      importer: 'custom_tabular',
      preset_id: (created.json() as Json).id,
      dataset_name: 'vendor',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as Json)).toMatchObject({ status: 'staged', row_count: 1, kind: 'protein_quant' });
  });
});
