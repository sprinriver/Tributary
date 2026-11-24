import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { ONC_DIA_05, publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('interaction networks', () => {
  let t: TestApi;
  let admin: string;
  let scientist: string;
  let outsider: string;
  let release: string;
  // Hit genes of the demo topTable at adjusted p ≤ 0.05 and |log2 FC| ≥ 1.
  const [header, ...lines] = readFileSync(`${ONC_DIA_05}/toptable.tsv`, 'utf8').trim().split('\n');
  const cols = header!.split('\t');
  const rows = lines.map((l) => {
    const v = l.split('\t');
    return {
      gene: (v[cols.indexOf('Genes')] ?? '').split(';').filter(Boolean)[0]!,
      logFC: Number(v[cols.indexOf('logFC')]),
      adjP: Number(v[cols.indexOf('adj.P.Val')]),
    };
  });
  const up = rows.filter((r) => r.adjP <= 0.05 && r.logFC >= 1).map((r) => r.gene);
  const down = rows.filter((r) => r.adjP <= 0.05 && r.logFC <= -1).map((r) => r.gene);
  const other = rows.find((r) => r.adjP > 0.5)!.gene;
  const TSV = [
    `${up[0]}\t${up[1]}\t900`,
    `${up[0]}\t${down[0]}\t650`,
    `${down[1]}\t${other}\t950`, // one end is not a hit
    `${up[2]}\t${up[3]}\t400`, // below the score asked for
  ].join('\n');

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    const program = await t.program('PPI');
    const elsewhere = await t.program('PPX');
    scientist = (await t.user('ppi-scientist', { [program]: 'contributor' })).token;
    outsider = (await t.user('ppi-outsider', { [elsewhere]: 'contributor' })).token;
    const adminUser = await t.user('ppi-admin', {});
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
    ({ release } = await publishedDaRelease(t, scientist, program, 'Interactions DA'));
  }, 300_000);
  afterAll(() => t.close());

  const importNetwork = (token: string, interactions = TSV) =>
    t.call(token, {
      method: 'POST',
      url: '/v1/interaction-collections',
      payload: {
        name: 'Test interactions',
        source: 'STRING',
        source_release: 'v12.0, combined score ≥ 0.4',
        species: 'NCBITaxon:9606',
        id_type: 'gene_symbol',
        licence: 'CC BY 4.0',
        interactions,
      },
      headers: { 'x-change-reason': 'load interactions' },
    });
  let collection: string;

  it('PPI-02: a system admin imports an interaction collection; it is listed and audited; others may not import', async () => {
    expect((await importNetwork(scientist)).statusCode).toBe(403);
    const bad = await importNetwork(admin, 'A\tB\tstrong');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ code: 'invalid_interactions', field: 'interactions' });
    const res = await importNetwork(admin);
    expect(res.statusCode, res.body).toBe(201);
    collection = (res.json() as Json).id;
    expect(res.json()).toMatchObject({
      name: 'Test interactions',
      source: 'STRING',
      edge_count: 4,
      node_count: 7,
    });
    const list = (
      await t.call(scientist, { method: 'GET', url: '/v1/interaction-collections' })
    ).json() as Json;
    expect(list.items.map((c: Json) => c.id)).toContain(collection);
    const audit = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', collection)
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['interactions.import']);
  });

  it('PPI-03: the network of a contrast’s hits: edges between two hits at the score asked for, with counts and attribution', async () => {
    const res = await t.call(scientist, {
      method: 'POST',
      url: '/v1/interactions/network',
      payload: { release_id: release, collection_id: collection, min_score: 600 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.edges).toEqual([
      { a: [up[0], up[1]].sort()[0], b: [up[0], up[1]].sort()[1], score: 900 },
      { a: [up[0], down[0]].sort()[0], b: [up[0], down[0]].sort()[1], score: 650 },
    ]);
    expect(body.nodes.map((n: Json) => n.id).sort()).toEqual([up[0], up[1], down[0]].sort());
    const hub = body.nodes.find((n: Json) => n.id === up[0]);
    expect(hub).toMatchObject({ degree: 2, direction: 'up' });
    expect(hub.log2_fc).toBeGreaterThanOrEqual(1);
    expect(body.provenance.counts).toMatchObject({
      hits: up.length + down.length,
      hits_in_collection: 6, // up[0..3], down[0], down[1]
      edges: 2,
      edges_shown: 2,
      hits_connected: 3,
    });
    expect(body.provenance).toMatchObject({
      collection: { name: 'Test interactions', source: 'STRING', licence: 'CC BY 4.0' },
      min_score: 600,
    });
    expect(body.provenance.notes.join(' ')).toMatch(
      /known or predicted associations.*not measured in this experiment/,
    );
  });

  it('PPI-03: readable releases only; a differential-abundance release is required', async () => {
    const hidden = await t.call(outsider, {
      method: 'POST',
      url: '/v1/interactions/network',
      payload: { release_id: release, collection_id: collection },
    });
    expect(hidden.statusCode).toBe(404);
  });
});
