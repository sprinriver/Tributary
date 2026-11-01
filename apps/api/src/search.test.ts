import { seedDatabase } from '@tributary/db';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { manifestRows } from './testing-data.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');

/**
 * Golden queries on the seeded corpus (SPEC M9): the expected experiment must be in the top 3 experiment hits.
 * Words with no match (e.g. "inhibitor") must not stop the others from ranking.
 */
const GOLDEN: [string, string[]][] = [
  ['HEK293 inhibitor 24 hours', ['IMM-DIA-04', 'IMM-TMT-08']], // the SPEC M9 E2E check
  ['dose series HeLa', ['ONC-DIA-01']],
  ['A549 CRISPR screen', ['ONC-CRI-11']],
  ['K562 RNA-seq', ['IMM-RNA-10']],
  ['CPD-000005 MCF-7', ['ONC-DIA-05']],
  ['TMT contrast A-549', ['ONC-TMT-07']],
  ['Demo compound 8', ['IMM-TMT-08']],
  ['human embryonic kidney TMT', ['IMM-TMT-08']],
  ['MCF7 proteomics', ['ONC-DIA-05']],
  ['14 days screen K-562', ['IMM-CRI-12']],
  ['Immunology dose series K-562', ['IMM-DIA-03']],
  ['oncology RNA-seq HeLa', ['ONC-RNA-09']],
];

/**
 * Fake `local` embedder (apps/compute /embed): texts mentioning HEK293 point one way, everything else another;
 * the query "zz-kidney-like" (no full-text match anywhere) points at HEK293.
 */
function fakeCompute(next: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.endsWith('/embed')) return next(input, init);
    const body = JSON.parse(String(init?.body)) as { texts: string[]; dims: number };
    const embeddings = body.texts.map((text) => {
      const v = new Array<number>(body.dims).fill(0);
      v[/hek293|zz-kidney-like/i.test(text) ? 0 : 1] = 1;
      return v;
    });
    return Response.json({ model: 'hashing-test', dims: body.dims, embeddings });
  }) as typeof fetch;
}

async function systemAdmin(t: TestApi, name: string): Promise<string> {
  const user = await t.user(name, {});
  const { tenant_id } = await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow();
  await t.db
    .insertInto('role_binding')
    .values({ tenant_id, created_by: user.id, user_id: user.id, program_id: null, role: 'system_admin' })
    .execute();
  return user.token;
}

describe('search (SPEC M9)', () => {
  let t: TestApi;
  let both: string;
  let oncViewer: string;
  let oncContributor: string;
  let admin: string;
  let ONC: string;
  let IMM: string;

  const search = async (token: string, params: Record<string, string | string[]>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) qs.append(k, x);
    return t.call(token, { method: 'GET', url: `/v1/search?${qs}` });
  };
  const names = (res: { json(): unknown }) =>
    ((res.json() as Json).items as Json[]).map((h) => h.experiment_name);

  beforeAll(async () => {
    t = await startTestApi({ fetch: fakeCompute(fetch) });
    await seedDatabase(t.db, { fixturesDir: FIXTURES });
    const programs = await t.db.selectFrom('program').select(['id', 'code']).execute();
    ONC = programs.find((p) => p.code === 'ONC')!.id;
    IMM = programs.find((p) => p.code === 'IMM')!.id;
    both = (await t.user('search-both', { [ONC]: 'viewer', [IMM]: 'viewer' })).token;
    oncViewer = (await t.user('search-onc', { [ONC]: 'viewer' })).token;
    oncContributor = (await t.user('search-onc-contrib', { [ONC]: 'contributor' })).token;
    admin = await systemAdmin(t, 'search-admin');
  });
  afterAll(async () => t?.close());

  it('SRCH-01: golden queries on the seeded corpus reach a top-3 hit rate of at least 90% with full-text only', async () => {
    const misses: string[] = [];
    for (const [q, expected] of GOLDEN) {
      const res = await search(both, { q, type: 'experiment' });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as Json;
      expect(body.mode).toBe('fulltext');
      const top3 = (body.items as Json[]).slice(0, 3).map((h) => String(h.experiment_name));
      if (!top3.some((name) => expected.some((key) => name.startsWith(key))))
        misses.push(`${q} → ${top3.join(' | ')}`);
    }
    expect((GOLDEN.length - misses.length) / GOLDEN.length, misses.join('\n')).toBeGreaterThanOrEqual(0.9);
  });

  it('SRCH-01: the SPEC query finds the HEK293 experiment first and reports ontology expansions', async () => {
    const body = (await search(both, { q: 'HEK293 inhibitor 24 hours', type: 'experiment' })).json() as Json;
    expect(String(body.items[0].experiment_name)).toMatch(/^IMM-(DIA-04|TMT-08)/);
    expect(body.items[0]).toMatchObject({ type: 'experiment', program_code: 'IMM', status: 'published' });
    expect(body.items[0].snippet).toEqual(expect.any(String));
    // "human embryonic kidney" reaches HEK293 through the Cellosaurus synonyms of the term.
    const synonyms = (await search(both, { q: 'human embryonic kidney', type: 'experiment' })).json() as Json;
    expect(synonyms.expansions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'HEK293', term_id: 'cellosaurus:CVCL_0045' }),
      ]),
    );
    expect(String(synonyms.items[0].experiment_name)).toMatch(/HEK293/);
  });

  it('SRCH-01: samples are searchable by their searchable fields and link to their experiment', async () => {
    const body = (await search(both, { q: 'ONC-DIA-01-S03', type: 'sample' })).json() as Json;
    expect(body.items[0]).toMatchObject({ type: 'sample', title: 'ONC-DIA-01-S03' });
    expect(String(body.items[0].experiment_name)).toMatch(/^ONC-DIA-01/);
    expect(body.items[0].experiment_version_id).toEqual(expect.any(String));
  });

  it('SRCH-01: publishing a version reindexes it; drafts are not searchable', async () => {
    const created = (
      await t.call(oncContributor, {
        method: 'POST',
        url: '/v1/experiments',
        payload: { program_id: ONC, assay_type: 'proteomics_dia', name: 'Zebrafinch reindex check' },
        headers: { 'x-change-reason': 'test' },
      })
    ).json() as Json;
    const version = created.versions[0].id as string;
    await t.call(oncContributor, {
      method: 'PUT',
      url: `/v1/versions/${version}/samples`,
      payload: { rows: manifestRows() },
      headers: { 'x-change-reason': 'test' },
    });
    expect(names(await search(oncViewer, { q: 'Zebrafinch' }))).toEqual([]);
    const published = await t.call(oncContributor, {
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      payload: { reason: 'ready' },
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(names(await search(oncViewer, { q: 'Zebrafinch', type: 'experiment' }))).toEqual([
      'Zebrafinch reindex check',
    ]);
    // Archiving the experiment removes it from search.
    await t.call(oncContributor, {
      method: 'POST',
      url: `/v1/experiments/${created.id}/archive`,
      headers: { 'x-change-reason': 'test' },
    });
    expect(names(await search(oncViewer, { q: 'Zebrafinch' }))).toEqual([]);
  });

  it('SRCH-03: a viewer of one program never sees another program in hits, totals or facets', async () => {
    // HEK293 exists only in IMM.
    const imm = (await search(oncViewer, { q: 'HEK293' })).json() as Json;
    expect(imm.items).toEqual([]);
    expect(imm.total).toBe(0);
    expect(imm.facets.program).toEqual([]);
    // A query that matches both programs returns only ONC, and facets count only ONC.
    const mixed = (await search(oncViewer, { q: 'dose series', limit: '50' })).json() as Json;
    expect(mixed.items.length).toBeGreaterThan(0);
    expect(new Set((mixed.items as Json[]).map((h) => h.program_id))).toEqual(new Set([ONC]));
    expect((mixed.facets.program as Json[]).map((f) => f.value)).toEqual([ONC]);
    // Asking for the other program by filter returns nothing rather than leaking.
    const filtered = (await search(oncViewer, { q: 'dose series', program_id: IMM })).json() as Json;
    expect(filtered.items).toEqual([]);
    expect(filtered.total).toBe(0);
    // Paging past the end does not reveal more.
    const page2 = (await search(oncViewer, { q: 'HEK293', limit: '1' })).json() as Json;
    expect(page2.next_cursor).toBeNull();
  });

  it('SRCH-03: signed-out callers get 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/search?q=HEK293' });
    expect(res.statusCode).toBe(401);
  });

  it('SRCH-03: facets count assay type, program, species, compound and status, and filter the hits', async () => {
    const body = (await search(both, { q: 'K-562', type: 'experiment' })).json() as Json;
    const assay = Object.fromEntries((body.facets.assay_type as Json[]).map((f) => [f.value, f.count]));
    expect(assay).toEqual({ proteomics_dia: 2, rnaseq: 1, crispr_screen: 1 });
    expect(body.facets.assay_type.find((f: Json) => f.value === 'rnaseq').label).toBe('RNA-seq');
    expect(body.facets.program).toEqual([expect.objectContaining({ value: IMM, label: 'IMM', count: 4 })]);
    expect(body.facets.species).toEqual([expect.objectContaining({ label: 'Homo sapiens', count: 4 })]);
    expect((body.facets.compound as Json[]).map((f) => f.value)).toEqual(
      expect.arrayContaining(['CPD-000003', 'CPD-000006']),
    );
    expect(body.facets.status).toEqual([expect.objectContaining({ value: 'published', count: 4 })]);

    const rna = (await search(both, { q: 'K-562', type: 'experiment', assay_type: 'rnaseq' })).json() as Json;
    expect(names({ json: () => rna })).toEqual([expect.stringMatching(/^IMM-RNA-10/)]);
    // Facets show every value of the matching set (other values stay selectable).
    expect((rna.facets.assay_type as Json[]).length).toBe(3);
    const cpd = (await search(both, { q: 'K-562', compound: 'CPD-000006' })).json() as Json;
    expect(new Set((cpd.items as Json[]).map((h) => String(h.experiment_name).slice(0, 10)))).toEqual(
      new Set(['IMM-DIA-06']),
    );
  });

  it('SRCH-03: queries are validated with field errors', async () => {
    const empty = await search(both, { q: '   ' });
    expect(empty.statusCode).toBe(400);
    expect((empty.json() as Json).field).toBe('q');
    const big = await search(both, { q: 'x', limit: '500' });
    expect(big.statusCode).toBe(400);
  });

  it('SRCH-02: with an embedding provider, vector hits are fused with full-text by reciprocal rank and stay program-scoped', async () => {
    const hybrid = await startTestApi({
      fetch: fakeCompute(fetch),
      config: { search: { provider: 'local', dims: 1024, minSimilarity: 0.3 } },
    });
    try {
      await seedDatabase(hybrid.db, { fixturesDir: FIXTURES });
      const programs = await hybrid.db.selectFrom('program').select(['id', 'code']).execute();
      const onc = programs.find((p) => p.code === 'ONC')!.id;
      const imm = programs.find((p) => p.code === 'IMM')!.id;
      const viewerBoth = (await hybrid.user('h-both', { [onc]: 'viewer', [imm]: 'viewer' })).token;
      const viewerOnc = (await hybrid.user('h-onc', { [onc]: 'viewer' })).token;
      const adminToken = await systemAdmin(hybrid, 'h-admin');

      const reindex = await hybrid.call(adminToken, {
        method: 'POST',
        url: '/v1/admin/search/reindex',
        headers: { 'x-change-reason': 'test' },
      });
      expect(reindex.statusCode, reindex.body).toBe(200);
      expect(reindex.json()).toMatchObject({ provider: 'local', embedded: expect.any(Number) });
      expect((reindex.json() as Json).embedded).toBeGreaterThan(0);
      const audit = await hybrid.db
        .selectFrom('audit_log')
        .select('action')
        .where('action', '=', 'search.reindex')
        .execute();
      expect(audit).toHaveLength(1);

      const call = (token: string, q: string) =>
        hybrid.call(token, { method: 'GET', url: `/v1/search?q=${encodeURIComponent(q)}&type=experiment` });
      // No full-text match anywhere: only the vector side answers.
      const semantic = (await call(viewerBoth, 'zz-kidney-like')).json() as Json;
      expect(semantic.mode).toBe('hybrid');
      expect(String(semantic.items[0].experiment_name)).toMatch(/HEK293/);
      expect(semantic.items[0].ranks).toEqual({ fulltext: null, vector: 1 });
      // The vector sub-query is permission-filtered too.
      const scoped = (await call(viewerOnc, 'zz-kidney-like')).json() as Json;
      expect(scoped.items).toEqual([]);
      // Both sides agree → both ranks present, fused score is the sum of 1/(k + rank).
      const agree = (await call(viewerBoth, 'HEK293')).json() as Json;
      const top = agree.items[0] as Json;
      expect(top.ranks.fulltext).toEqual(expect.any(Number));
      expect(top.ranks.vector).toEqual(expect.any(Number));
      expect(top.score).toBeCloseTo(1 / (60 + top.ranks.fulltext) + 1 / (60 + top.ranks.vector), 10);
    } finally {
      await hybrid.close();
    }
  });

  it('SRCH-02: reindex requires a system admin', async () => {
    const res = await t.call(oncContributor, {
      method: 'POST',
      url: '/v1/admin/search/reindex',
      headers: { 'x-change-reason': 'test' },
    });
    expect(res.statusCode).toBe(403);
    const ok = await t.call(admin, {
      method: 'POST',
      url: '/v1/admin/search/reindex',
      headers: { 'x-change-reason': 'test' },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ provider: 'none', embedded: 0, documents: expect.any(Number) });
  });
});
