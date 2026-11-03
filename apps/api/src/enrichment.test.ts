import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/experiments/ONC-DIA-05');

// Phase 24 (ENR-02, ENR-03). The statistics are tested in apps/compute (pytest); here the API's part: gene-set
// collections, and which identifiers go to compute as hits and background.

/** Records /stats/enrichment calls and answers with one term per set (values are not checked here). */
function computeStub() {
  const calls: Json[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname !== '/stats/enrichment') return new Response('{}', { status: 404 });
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    calls.push(body);
    return Response.json({
      terms: (body.gene_sets as Json[]).map((s) => ({
        id: s.id,
        name: s.name,
        size: s.members.length,
        overlap: 1,
        expected: 0.5,
        fold_enrichment: 2,
        p_value: 0.01,
        adj_p_value: 0.02,
        genes: [s.members[0]],
      })),
      n_hits: body.hits.length,
      n_background: body.background.length,
      tested: body.gene_sets.length,
      excluded_small: 0,
      excluded_large: 0,
      method: 'hypergeometric (one-sided), ORA',
      adj_method: 'BH',
      compute_version: 'tributary-compute 0.0.0; scipy 1.18.0',
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('pathway enrichment', () => {
  let t: TestApi;
  let admin: string;
  let scientist: string;
  let outsider: string;
  let release: string;
  const stub = computeStub();
  // The demo topTable (one row per protein group; Genes holds the group's gene symbols, ";"-separated).
  const [header, ...lines] = readFileSync(`${FIXTURES}/toptable.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  const rows = lines.map((l) => {
    const v = l.split('\t');
    return {
      genes: (v[cols.indexOf('Genes')] ?? '').split(';').filter(Boolean),
      logFC: Number(v[cols.indexOf('logFC')]),
      adjP: Number(v[cols.indexOf('adj.P.Val')]),
    };
  });
  const genesOf = (keep: (r: (typeof rows)[number]) => boolean) => [
    ...new Set(rows.filter(keep).flatMap((r) => r.genes)),
  ];
  const up = genesOf((r) => r.adjP <= 0.05 && r.logFC >= 1);
  const down = genesOf((r) => r.adjP <= 0.05 && r.logFC <= -1);
  const all = genesOf(() => true);
  const hitFeatures = rows.filter((r) => r.adjP <= 0.05 && Math.abs(r.logFC) >= 1).length;
  const GMT = [
    `UP_SET\tMostly up\t${up.slice(0, 8).join('\t')}\t${all.slice(-3).join('\t')}`,
    `DOWN_SET\tMostly down\t${down.slice(0, 8).join('\t')}`,
    `MIXED\thttp://example.org/mixed\t${all.slice(0, 20).join('\t')}\tNOT_MEASURED_1`,
  ].join('\n');

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true, fetch: stub.fetchImpl });
    const program = await t.program('ENR');
    const other = await t.program('ENX');
    scientist = (await t.user('enr-scientist', { [program]: 'contributor' })).token;
    outsider = (await t.user('enr-outsider', { [other]: 'contributor' })).token;
    const adminUser = await t.user('enr-admin', {});
    const tenant = (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id;
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: tenant,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
    ({ release } = await publishedDaRelease(t, scientist, program, 'Enrichment DA'));
  }, 300_000);
  afterAll(() => t.close());

  const importSets = (token: string, gmt = GMT) =>
    t.call(token, {
      method: 'POST',
      url: '/v1/gene-set-collections',
      payload: {
        name: 'Synthetic pathways',
        source: 'synthetic',
        source_release: 'test-1',
        species: 'NCBITaxon:9606',
        id_type: 'gene_symbol',
        gmt,
      },
      headers: { 'x-change-reason': 'load gene sets' },
    });

  let collection: string;

  it('ENR-02: a system admin imports a GMT collection; it is listed and audited; others may not import', async () => {
    expect((await importSets(scientist)).statusCode).toBe(403);
    const res = await importSets(admin);
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as Json;
    collection = body.id;
    expect(body).toMatchObject({
      name: 'Synthetic pathways',
      source: 'synthetic',
      set_count: 3,
      id_type: 'gene_symbol',
    });
    expect(body.member_count).toBe(up.slice(0, 8).length + 3 + down.slice(0, 8).length + 20 + 1);
    const list = (await t.call(scientist, { method: 'GET', url: '/v1/gene-set-collections' })).json() as Json;
    expect(list.items.map((c: Json) => c.id)).toContain(collection);
    const audit = await t.db
      .selectFrom('audit_log')
      .select(['action', 'reason'])
      .where('entity_id', '=', collection)
      .execute();
    expect(audit).toEqual([{ action: 'gene_sets.import', reason: 'load gene sets' }]);
  });

  it('ENR-02: a malformed GMT is rejected with the line number', async () => {
    const res = await importSets(admin, 'A\tSet A\tX\nB\tno members\n');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_gmt', field: 'gmt' });
    expect((res.json() as Json).message).toMatch(/line 2/);
  });

  const enrich = (token: string, extra: Json = {}) =>
    t.call(token, {
      method: 'POST',
      url: '/v1/enrichment',
      payload: { release_id: release, collection_id: collection, min_size: 1, ...extra },
    });

  it('ENR-03: hits and background come from the contrast; protein groups become gene symbols; provenance', async () => {
    stub.calls.length = 0;
    const res = await enrich(scientist);
    expect(res.statusCode, res.body).toBe(200);
    const sent = stub.calls[0]!;
    expect([...sent.hits].sort()).toEqual([...up, ...down].sort());
    expect([...sent.background].sort()).toEqual([...all].sort());
    expect(sent.gene_sets.map((s: Json) => s.id).sort()).toEqual(['DOWN_SET', 'MIXED', 'UP_SET']);
    expect(sent.min_size).toBe(1);
    const body = res.json() as Json;
    expect(body.terms).toHaveLength(3);
    expect(body.provenance).toMatchObject({
      release_id: release,
      collection: { id: collection, source: 'synthetic', source_release: 'test-1' },
      thresholds: { direction: 'both', adj_p_max: 0.05, abs_log2fc_min: 1, min_size: 1, max_size: 500 },
      features: rows.length,
      hit_features: hitFeatures,
      background: all.length,
      hits: up.length + down.length,
      adj_method: 'BH',
    });
    expect(body.provenance.contrast_label).toContain(' vs ');
    expect(body.provenance.transformations.join(' ')).toMatch(/gene symbol/i);
  });

  it('ENR-03: direction and thresholds select the hits', async () => {
    stub.calls.length = 0;
    await enrich(scientist, { direction: 'up' });
    await enrich(scientist, { direction: 'down', abs_log2fc_min: 2 });
    expect([...stub.calls[0]!.hits].sort()).toEqual([...up].sort());
    const strongDown = genesOf((r) => r.adjP <= 0.05 && r.logFC <= -2);
    expect([...stub.calls[1]!.hits].sort()).toEqual([...strongDown].sort());
  });

  it('ENR-03: untested features (no adjusted p or fold change) are not in the background, and are counted', async () => {
    // The same topTable with three rows untested (NA), e.g. removed by the tool's independent filtering.
    const [head, ...body] = readFileSync(`${FIXTURES}/toptable.tsv`, 'utf8').trim().split('\n');
    const untested = body.slice(-3).map((l) => l.split('\t')[1]!);
    const edited = [
      head,
      ...body.map((l, i) => {
        if (i < body.length - 3) return l;
        const v = l.split('\t');
        v[cols.indexOf('logFC')] = 'NA';
        v[cols.indexOf('P.Value')] = 'NA';
        v[cols.indexOf('adj.P.Val')] = 'NA';
        return v.join('\t');
      }),
    ].join('\n');
    const program = (
      await t.db.selectFrom('program').select('id').where('code', '=', 'ENR').executeTakeFirstOrThrow()
    ).id;
    const na = await publishedDaRelease(t, scientist, program, 'Enrichment DA with NA', {
      bytes: Buffer.from(edited + '\n'),
    });
    stub.calls.length = 0;
    const res = await enrich(scientist, { release_id: na.release });
    expect(res.statusCode, res.body).toBe(200);
    const sent = stub.calls[0]!;
    for (const g of untested) expect(sent.background).not.toContain(g);
    expect((res.json() as Json).provenance).toMatchObject({
      untested_features: 3,
      background: all.length - 3,
    });
  });

  it('ENR-03: with a zero fold-change threshold, direction is a strict sign test', async () => {
    stub.calls.length = 0;
    await enrich(scientist, { direction: 'up', abs_log2fc_min: 0 });
    expect([...stub.calls[0]!.hits].sort()).toEqual(genesOf((r) => r.adjP <= 0.05 && r.logFC > 0).sort());
  });

  it('ENR-03: a hit protein group with several genes is reported, not hidden', async () => {
    // Every feature is a hit: the two-gene group (HSP90AA1;HSP90AB1) is one feature but two identifiers.
    const res = await enrich(scientist, { adj_p_max: 1, abs_log2fc_min: 0 });
    expect((res.json() as Json).provenance).toMatchObject({ multi_id_hit_features: 1 });
  });

  it('ENR-03: the annotated universe keeps only identifiers that are in at least one set', async () => {
    stub.calls.length = 0;
    const res = await enrich(scientist, { universe: 'annotated' });
    expect(res.statusCode, res.body).toBe(200);
    const members = new Set(GMT.split('\n').flatMap((l) => l.split('\t').slice(2)));
    expect([...stub.calls[0]!.background].sort()).toEqual(all.filter((g) => members.has(g)).sort());
    expect(stub.calls[0]!.hits.every((g: string) => members.has(g))).toBe(true);
    expect((res.json() as Json).provenance).toMatchObject({ universe: 'annotated' });
  });

  it('ENR-03: a collection for another species than the experiment is refused', async () => {
    const program = (
      await t.db.selectFrom('program').select('id').where('code', '=', 'ENR').executeTakeFirstOrThrow()
    ).id;
    const human = await publishedDaRelease(t, scientist, program, 'Enrichment DA human', {
      species: { id: 'NCBITaxon:9606', label: 'Homo sapiens' },
    });
    const mouse = (
      await t.call(admin, {
        method: 'POST',
        url: '/v1/gene-set-collections',
        payload: {
          name: 'Mouse sets',
          source: 'synthetic',
          source_release: 'm1',
          species: 'NCBITaxon:10090',
          id_type: 'gene_symbol',
          gmt: GMT,
        },
        headers: { 'x-change-reason': 'mouse' },
      })
    ).json() as Json;
    const res = await enrich(scientist, { release_id: human.release, collection_id: mouse.id });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'species_mismatch', field: 'collection_id' });
  });

  it('ENR-03: other programs cannot see the release; unknown collections are not found; no hits is a field error', async () => {
    expect((await enrich(outsider)).statusCode).toBe(404);
    expect(
      (await enrich(scientist, { collection_id: '01a19acc-804b-750b-a4df-b0582b0ff218' })).statusCode,
    ).toBe(404);
    const none = await enrich(scientist, { abs_log2fc_min: 19 });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ code: 'no_hits', field: 'abs_log2fc_min' });
  });
});
