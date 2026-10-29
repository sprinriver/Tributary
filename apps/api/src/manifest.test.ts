import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Fake outbound HTTP: OLS4 search and the compute service's SDRF endpoints. */
const calls: { url: string; body?: unknown }[] = [];
let olsDown = false;
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, body });
  if (url.includes('/api/search')) {
    if (olsDown) return new Response('unavailable', { status: 503 });
    return Response.json({
      response: {
        docs: [
          {
            obo_id: 'NCBITaxon:10090',
            label: 'Mus musculus',
            ontology_name: 'ncbitaxon',
            synonym: ['house mouse'],
          },
          { obo_id: 'NCBITaxon:10088', label: 'Mus', ontology_name: 'ncbitaxon' },
        ],
      },
    });
  }
  if (url.endsWith('/sdrf/export')) {
    return Response.json({ sdrf: 'source name\tcomment[data file]\nS1\trun1.raw\n', errors: [] });
  }
  if (url.endsWith('/sdrf/import')) {
    return Response.json({
      rows: [{ sample_key: 'S9', source_name: 'from sdrf', organism: 'homo sapiens', raw_file: 'run9.raw' }],
      errors: [],
    });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

describe('manifest editor API', () => {
  let t: TestApi;
  let program: string;
  let contributor: string;
  let viewer: string;

  beforeAll(async () => {
    t = await startTestApi({ fetch: fakeFetch });
    program = await t.program('M1');
    contributor = (await t.user('m-contributor', { [program]: 'contributor' })).token;
    viewer = (await t.user('m-viewer', { [program]: 'viewer' })).token;
  });
  afterAll(() => t.close());

  const search = (q: string, ontology = 'NCBITaxon') =>
    t.call(contributor, { method: 'GET', url: '/v1/ontology/search', query: { ontology, q } });

  it('MAN-04: ontology search goes to OLS4 once, then a repeated lookup is served from the Postgres cache', async () => {
    const first = await search('mus');
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      source: 'ols',
      items: [{ id: 'NCBITaxon:10090', label: 'Mus musculus' }, { id: 'NCBITaxon:10088' }],
    });
    const olsCalls = () => calls.filter((c) => c.url.includes('/api/search')).length;
    expect(olsCalls()).toBe(1);
    expect(calls[0]!.url).toContain('ontology=ncbitaxon');

    const second = await search('mus');
    expect(second.json()).toMatchObject({
      source: 'cache',
      items: [{ id: 'NCBITaxon:10090' }, { id: 'NCBITaxon:10088' }],
    });
    expect(olsCalls()).toBe(1);

    const cached = await t.db
      .selectFrom('ontology_term_cache')
      .selectAll()
      .where('term_id', '=', 'NCBITaxon:10090')
      .executeTakeFirst();
    expect(cached).toMatchObject({ label: 'Mus musculus', ontology: 'ncbitaxon' });
  });

  it('MAN-04: when OLS4 is unreachable the search falls back to local terms', async () => {
    olsDown = true;
    const res = await search('homo');
    olsDown = false;
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      source: 'local',
      items: [{ id: 'NCBITaxon:9606', label: 'Homo sapiens' }],
    });
  });

  it('MAN-04: ontology search validates its query', async () => {
    const res = await search('', 'NCBITaxon');
    expect(res.statusCode).toBe(400);
  });

  it('MAN-03: column-mapping presets are saved and listed per program; viewers cannot create them', async () => {
    const body = {
      name: 'Core facility export',
      mapping: { 'Sample ID': 'sample_key', Species: 'organism', Position: 'well' },
    };
    const created = await t.call(contributor, {
      method: 'POST',
      url: `/v1/programs/${program}/mapping-presets`,
      payload: body,
    });
    expect(created.statusCode, created.body).toBe(201);
    const listed = await t.call(viewer, { method: 'GET', url: `/v1/programs/${program}/mapping-presets` });
    expect((listed.json() as Json).items).toMatchObject([body]);
    const denied = await t.call(viewer, {
      method: 'POST',
      url: `/v1/programs/${program}/mapping-presets`,
      payload: body,
    });
    expect(denied.statusCode).toBe(403);
    const bad = await t.call(contributor, {
      method: 'POST',
      url: `/v1/programs/${program}/mapping-presets`,
      payload: { name: 'x', mapping: { A: 'not_a_field!' } },
    });
    expect(bad.statusCode).toBe(400);
  });

  async function draftVersion(): Promise<string> {
    const res = await t.call(contributor, {
      method: 'POST',
      url: '/v1/experiments',
      payload: { program_id: program, assay_type: 'proteomics_dia', name: 'SDRF' },
    });
    const version = (res.json() as Json).versions[0].id as string;
    await t.call(contributor, {
      method: 'PUT',
      url: `/v1/versions/${version}/samples`,
      payload: {
        rows: [{ sample_key: 'S1', source_name: 's1', organism: 'Homo sapiens', raw_file: 'run1.raw' }],
      },
    });
    return version;
  }

  it('MAN-06: SDRF export sends the version samples to apps/compute and downloads the file', async () => {
    const version = await draftVersion();
    const res = await t.call(contributor, { method: 'GET', url: `/v1/versions/${version}/sdrf` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/tab-separated-values');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*\.sdrf\.tsv"/);
    expect(res.body.startsWith('source name')).toBe(true);
    const sent = calls.findLast((c) => c.url.endsWith('/sdrf/export'));
    expect(sent?.body).toMatchObject({
      assay_type: 'proteomics_dia',
      rows: [{ sample_key: 'S1', raw_file: 'run1.raw' }],
    });
    const audit = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', version)
      .where('action', '=', 'sdrf.export')
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('MAN-06: SDRF import maps rows through apps/compute and upserts them into the draft', async () => {
    const version = await draftVersion();
    const res = await t.call(contributor, {
      method: 'POST',
      url: `/v1/versions/${version}/sdrf`,
      payload: { sdrf: 'source name\tassay name\nfrom sdrf\tS9\n' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ saved: 1, errors: [] });
    const samples = await t.call(contributor, { method: 'GET', url: `/v1/versions/${version}/samples` });
    expect((samples.json() as Json).items.map((s: Json) => s.sample_key)).toEqual(['S1', 'S9']);
  });
});
