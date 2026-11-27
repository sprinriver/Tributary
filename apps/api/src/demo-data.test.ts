import { seedDatabase } from '@tributary/db';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_DATASETS, loadDemoData, type DemoDeps } from './demo/loader.ts';
import { startTestApi, type TestApi } from './testing.ts';

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');

describe('one-command demo data loader', () => {
  let t: TestApi;
  let contributor: string;
  let viewer: string;

  const deps = (token: string): DemoDeps => ({
    call: async (method, url, payload) => {
      const res = await t.call(token, {
        method,
        url,
        headers: { 'x-change-reason': 'demo data' },
        ...(payload === undefined ? {} : { payload: payload as object }),
      });
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
    },
    readFixture: (path) => readFileSync(resolve(FIXTURES, path)),
    putPart: async (url, bytes) => (await fetch(url, { method: 'PUT', body: bytes })).headers.get('etag'),
    settleIngest: async () => {
      await t.drainIngest();
    },
  });

  const published = () =>
    t.db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .select(['d.name', 'r.row_count', 'r.importer'])
      .where('r.status', '=', 'published')
      .orderBy('d.name')
      .execute();

  const latestVersions = () =>
    t.db
      .selectFrom('experiment as e')
      .innerJoin('experiment_version as v', 'v.experiment_id', 'e.id')
      .select(['e.name', 'v.version_number', 'v.status'])
      .where('v.is_latest_published', '=', true)
      .where('e.name', 'in', [
        'ONC-DIA-05: contrast in MCF-7',
        'ONC-DIA-01: dose series in HeLa',
        'IMM-DIA-06: contrast in K-562',
      ])
      .orderBy('e.name')
      .execute();

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    await seedDatabase(t.db, { fixturesDir: FIXTURES });
    const programs = await t.db.selectFrom('program').select(['id', 'code']).execute();
    const all = (role: string) => Object.fromEntries(programs.map((p) => [p.id, role]));
    contributor = (await t.user('demo-contrib', all('contributor'))).token;
    viewer = (await t.user('demo-viewer', all('viewer'))).token;
  }, 300_000);
  afterAll(() => t?.close());

  it('DEMO-01: a viewer cannot load demo data', async () => {
    await expect(loadDemoData(deps(viewer))).rejects.toThrow(/403/);
    expect(await published()).toEqual([]);
  });

  it('DEMO-01: loads every demo dataset as a published release on a new published version', async () => {
    const result = await loadDemoData(deps(contributor));
    expect(result.map((r) => [r.dataset, r.status])).toEqual(
      DEMO_DATASETS.map((d) => [d.dataset, 'created']),
    );
    expect(await published()).toEqual([
      { name: 'IMM-DIA-06 differential abundance', row_count: 157, importer: 'limma_toptable' },
      { name: 'ONC-DIA-01 dose response', row_count: 157, importer: 'curvecurator' },
      { name: 'ONC-DIA-05 differential abundance', row_count: 157, importer: 'limma_toptable' },
      { name: 'ONC-DIA-05 protein quant', row_count: 942, importer: 'diann_pg_matrix' },
    ]);
    expect(await latestVersions()).toEqual([
      { name: 'IMM-DIA-06: contrast in K-562', version_number: 2, status: 'published' },
      { name: 'ONC-DIA-01: dose series in HeLa', version_number: 2, status: 'published' },
      { name: 'ONC-DIA-05: contrast in MCF-7', version_number: 2, status: 'published' },
    ]);
    // 4 releases + 3 experiment versions, each audited with the loader's reason (the seed's own rows excluded).
    const audited = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('action', 'in', ['release.publish', 'experiment_version.publish'])
      .where('reason', 'like', 'Demo data%')
      .execute();
    expect(audited.filter((r) => r.action === 'release.publish').length).toBe(4);
    expect(audited.filter((r) => r.action === 'experiment_version.publish').length).toBe(3);
  });

  it('DEMO-01: differential releases carry the experiment contrast (numerator vs denominator)', async () => {
    const labels = await t.db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .select(['d.name', 'r.transformations'])
      .where('r.importer', '=', 'limma_toptable')
      .orderBy('d.name')
      .execute();
    expect(labels.map((r) => [r.name, JSON.stringify(r.transformations)])).toEqual([
      ['IMM-DIA-06 differential abundance', expect.stringContaining('CPD-000006@1 µM vs DMSO')],
      ['ONC-DIA-05 differential abundance', expect.stringContaining('CPD-000005@1 µM vs DMSO')],
    ]);
  });

  it('DEMO-01: running it again changes nothing', async () => {
    const before = await published();
    const result = await loadDemoData(deps(contributor));
    expect(result.every((r) => r.status === 'exists')).toBe(true);
    expect(await published()).toEqual(before);
    const versions = await t.db.selectFrom('experiment_version').select('id').execute();
    expect(versions.length).toBe(12 + 3);
  });
});
