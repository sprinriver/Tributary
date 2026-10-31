import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/experiments/ONC-DIA-05');
const TOPTABLE = readFileSync(`${FIXTURES}/toptable.tsv`);
const manifest = () => {
  const [header, ...lines] = readFileSync(`${FIXTURES}/samples.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  return lines.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i]!, v])));
};
const CONTRAST = { numerator: 'CPD-000005@1 µM', denominator: 'DMSO', label: 'CPD-000005@1 µM vs DMSO' };

describe('query API (QuerySpec → page, export)', () => {
  let t: TestApi;
  const a = { program: '', token: '', version: '', release: '' };
  const b = { program: '', token: '', version: '', release: '' };

  /** A published version with the ONC-DIA-05 manifest and a published limma differential-abundance release. */
  async function publishedDa(side: typeof a, name: string) {
    const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: Json) =>
      t.call(side.token, {
        method,
        url,
        ...(payload ? { payload } : {}),
        headers: { 'x-change-reason': 'test' },
      });
    const created = (
      await call('POST', '/v1/experiments', { program_id: side.program, assay_type: 'proteomics_dia', name })
    ).json() as Json;
    side.version = created.versions[0].id;
    expect((await call('PUT', `/v1/versions/${side.version}/samples`, { rows: manifest() })).statusCode).toBe(
      200,
    );
    const contrasts = (
      await call('PUT', `/v1/versions/${side.version}/contrasts`, { contrasts: [CONTRAST] })
    ).json() as Json;
    const started = (
      await call('POST', '/v1/files/uploads', {
        experiment_version_id: side.version,
        name: 'toptable.tsv',
        size_bytes: TOPTABLE.length,
        role: 'processed',
      })
    ).json() as Json;
    const put = await fetch(started.parts[0].url, { method: 'PUT', body: TOPTABLE });
    await call('POST', `/v1/files/${started.file.id}/complete`, {
      parts: [{ part_number: 1, etag: put.headers.get('etag') }],
    });
    await t.drainIngest();
    // Files are added to drafts; the version is published before its results are imported.
    const published = await call('POST', `/v1/versions/${side.version}/publish`, { reason: 'ready' });
    expect(published.statusCode, published.body).toBe(200);
    const imported = await call('POST', '/v1/imports', {
      file_id: started.file.id,
      importer: 'limma_toptable',
      contrast_id: (contrasts.items ?? contrasts)[0].id,
    });
    expect(imported.statusCode, imported.body).toBe(201);
    side.release = (imported.json() as Json).id;
    const release = await call('POST', `/v1/releases/${side.release}/publish`, { reason: 'checked' });
    expect(release.statusCode, release.body).toBe(200);
  }

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    a.program = await t.program('QRA');
    b.program = await t.program('QRB');
    a.token = (await t.user('qry-a', { [a.program]: 'contributor' })).token;
    b.token = (await t.user('qry-b', { [b.program]: 'contributor' })).token;
    await publishedDa(a, 'QRY program A');
    await publishedDa(b, 'QRY program B');
  }, 300_000);
  afterAll(() => t.close());

  const query = (token: string, spec: Json) =>
    t.call(token, { method: 'POST', url: '/v1/query', payload: spec });

  it('QRY-03: kind sources are scoped to the caller’s programs before compilation', async () => {
    const mine = await query(a.token, {
      source: { kind: 'differential_abundance', scope: {} },
      select: ['experiment_version_id', 'feature_id'],
      page: { size: 1000 },
    });
    expect(mine.statusCode, mine.body).toBe(200);
    const body = mine.json() as Json;
    expect(body.totalRows).toBeGreaterThan(0);
    expect(new Set(body.rows.map((r: Json) => r.experiment_version_id))).toEqual(new Set([a.version]));
    expect(body).toMatchObject({
      sqlHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      elapsedMs: expect.any(Number),
    });

    // Asking for another program's data yields nothing; naming its release is "unknown or not visible".
    const other = await query(a.token, {
      source: { kind: 'differential_abundance', scope: { programIds: [b.program] } },
    });
    expect((other.json() as Json).totalRows).toBe(0);
    const byId = await query(a.token, { source: { releaseIds: [b.release] } });
    expect(byId.statusCode).toBe(400);
    expect((byId.json() as Json).errors[0]).toMatchObject({ field: 'source', code: 'unknown_source' });

    const sqlField = await query(a.token, { source: { releaseIds: [a.release] }, sql: 'select 1' });
    expect(sqlField.statusCode).toBe(400);
    const anonymous = await t.app.inject({ method: 'POST', url: '/v1/query', payload: {} });
    expect(anonymous.statusCode).toBe(401);
  });

  it('QRY-02: joins off declared keys need advanced mode', async () => {
    const res = await query(a.token, {
      source: { releaseIds: [a.release] },
      joins: [
        {
          type: 'inner',
          target: { kind: 'sample', scope: {} },
          alias: 's',
          on: [{ left: 'contrast_label', op: '=', right: 's.condition' }],
        },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as Json).errors.map((e: Json) => e.code)).toContain('not_join_key');
  });

  it('QRY-06: a differential-abundance release joins to sample metadata (dose, time, cell line), program-scoped', async () => {
    const res = await query(a.token, {
      source: { releaseIds: [a.release] },
      joins: [
        {
          type: 'inner',
          target: { kind: 'sample', scope: {} },
          alias: 's',
          on: [{ left: 'experiment_version_id', op: '=', right: 's.experiment_version_id' }],
          where: {
            combinator: 'and',
            rules: [{ field: 'condition', operator: '=', value: CONTRAST.numerator }],
          },
        },
      ],
      select: ['feature_id', 'log2_fc', 's.sample_key', 's.cell_line', 's.dose_molar', 's.time_hours'],
      orderBy: [{ column: 'feature_id', dir: 'asc' }],
      page: { size: 100 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.rows.length).toBeGreaterThan(0);
    for (const row of body.rows) {
      expect(row).toMatchObject({ 's.cell_line': 'MCF-7', 's.time_hours': 24 });
      expect(row['s.dose_molar']).toBeCloseTo(1e-6, 12);
    }
    expect(new Set(body.rows.map((r: Json) => r['s.sample_key']))).toEqual(
      new Set(['ONC-DIA-05-S04', 'ONC-DIA-05-S05', 'ONC-DIA-05-S06']),
    );

    // The sample kind on its own only shows the caller's programs.
    const samples = (
      await query(a.token, { source: { kind: 'sample', scope: {} }, select: ['experiment_version_id'] })
    ).json() as Json;
    expect(samples.totalRows).toBe(6);
    expect(new Set(samples.rows.map((r: Json) => r.experiment_version_id))).toEqual(new Set([a.version]));
  });

  it('QRY-04: export streams to object storage, equals the paged rows, and is audited', async () => {
    const spec = {
      source: { releaseIds: [a.release] },
      where: { combinator: 'and', rules: [{ field: 'adj_p_value', operator: '<', value: 0.05 }] },
      select: ['feature_id', 'log2_fc', 'adj_p_value'],
      orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
    };
    const rows: Json[] = [];
    let cursor: string | null = null;
    do {
      const page = (
        await query(a.token, { ...spec, page: { size: 25, ...(cursor ? { cursor } : {}) } })
      ).json() as Json;
      rows.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor);
    expect(rows.length).toBeGreaterThan(0);

    const res = await t.call(a.token, {
      method: 'POST',
      url: '/v1/query/export',
      payload: { spec, format: 'csv' },
      headers: { 'x-change-reason': 'figure for the team meeting' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const exported = res.json() as Json;
    expect(exported).toMatchObject({ format: 'csv', row_count: rows.length });
    const csv = (await (await fetch(exported.url)).text()).trim().split('\n');
    expect(csv[0]).toBe('feature_id,log2_fc,adj_p_value');
    expect(csv.slice(1).map((l) => l.split(',')[0])).toEqual(rows.map((r) => r.feature_id));

    const audit = await t.db
      .selectFrom('audit_log')
      .select(['action', 'reason', 'after'])
      .where('action', '=', 'query.export')
      .executeTakeFirstOrThrow();
    expect(audit.reason).toBe('figure for the team meeting');
    expect(audit.after).toMatchObject({ format: 'csv', row_count: rows.length, release_ids: [a.release] });
  });
});
