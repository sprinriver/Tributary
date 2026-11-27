import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedDaRelease } from './testing-data.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Stage 1 of the public annotation plan: protein facts from the UniProt REST API, stored as dated reference rows.
// The stub mirrors the live service (rest.uniprot.org, release 2026_04): /uniprotkb/accessions returns
// `results[]`, leaves out unknown accessions, rejects a badly formatted one with 400 for the whole request, and
// names the release in the X-UniProt-Release header.
const UNI = 'https://uniprot.test';
const ACCESSION = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$/;

const entry = (acc: string, gene: string, name: string, fn: string, locations: string[]) => ({
  primaryAccession: acc,
  organism: { scientificName: 'Homo sapiens' },
  proteinDescription: { recommendedName: { fullName: { value: name } } },
  genes: [{ geneName: { value: gene } }],
  comments: [
    { commentType: 'FUNCTION', texts: [{ value: fn }] },
    { commentType: 'SUBCELLULAR LOCATION', subcellularLocations: locations.map((value) => ({ location: { value } })) },
  ],
});
const KNOWN: Record<string, Json> = {
  P31749: entry('P31749', 'AKT1', 'RAC-alpha serine/threonine-protein kinase', 'Kinase in growth signalling.', [
    'Cytoplasm',
    'Nucleus',
  ]),
  P09874: entry('P09874', 'PARP1', 'Poly [ADP-ribose] polymerase 1', 'Repairs DNA strand breaks.', ['Nucleus']),
};

function uniprotStub() {
  const requested: string[] = [];
  const agents: (string | null)[] = [];
  let release = '2026_04';
  let down = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.origin !== UNI) return new Response('not found', { status: 404 });
    if (down) throw new TypeError('fetch failed');
    agents.push(new Headers(init?.headers).get('user-agent'));
    const ids = (url.searchParams.get('accessions') ?? '').split(',').filter(Boolean);
    requested.push(...ids);
    const headers = { 'X-UniProt-Release': release, 'X-UniProt-Release-Date': '04-November-2026' };
    if (ids.some((id) => !ACCESSION.test(id)))
      return Response.json({ messages: ['invalid format'] }, { status: 400, headers });
    return Response.json({ results: ids.flatMap((id) => (KNOWN[id] ? [KNOWN[id]] : [])) }, { headers });
  }) as typeof fetch;
  return {
    fetchImpl,
    requested,
    agents,
    setRelease: (r: string) => (release = r),
    setDown: (d: boolean) => (down = d),
  };
}

describe('protein facts from UniProt (public annotation plan, stage 1)', () => {
  let t: TestApi;
  let admin: string;
  let contributor: string;
  const stub = uniprotStub();

  const refresh = (token: string) =>
    t.call(token, {
      method: 'POST',
      url: '/v1/admin/reference/uniprot',
      payload: {},
      headers: { 'x-change-reason': 'monthly refresh' },
    });
  const uniprotRows = (deleted: boolean) =>
    t.db
      .selectFrom('target_annotation')
      .select(['uniprot_accession', 'gene_symbol', 'key', 'value', 'source', 'source_release', 'retrieved_at'])
      .where('source', '=', 'UniProt')
      .where('deleted_at', deleted ? 'is not' : 'is', null)
      .orderBy('uniprot_accession')
      .orderBy('key')
      .execute();

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true, fetch: stub.fetchImpl, config: { uniprotUrl: UNI } });
    const program = await t.program('UNI');
    contributor = (await t.user('uni-contrib', { [program]: 'contributor' })).token;
    const adminUser = await t.user('uni-admin', {});
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
    await publishedDaRelease(t, contributor, program, 'UNI-DA-01');
  }, 300_000);
  afterAll(() => t?.close());

  it('UNI-01: only a system admin can refresh UniProt facts', async () => {
    expect((await refresh(contributor)).statusCode).toBe(403);
    expect(stub.requested).toEqual([]);
  });

  it('UNI-01: a refresh stores UniProt facts for the accessions in published results, with the UniProt release', async () => {
    const res = await refresh(admin);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body).toMatchObject({ source: 'UniProt', release: '2026_04', updated: 2 });
    // Synthetic and other non-UniProt identifiers are never sent; unknown accessions are reported, not guessed.
    expect(stub.requested.every((id) => ACCESSION.test(id))).toBe(true);
    expect(stub.requested.some((id) => id.startsWith('SYNP'))).toBe(false);
    expect(stub.requested).toEqual(expect.arrayContaining(['P31749', 'P09874', 'P60709']));
    expect(body.skipped).toBeGreaterThan(0);
    expect(body.not_found).toContain('P60709');
    expect(body.not_found).not.toContain('P31749');
    expect(stub.agents.every((a) => a?.startsWith('Tributary/'))).toBe(true);

    const rows = await uniprotRows(false);
    const akt1 = rows.filter((r) => r.uniprot_accession === 'P31749');
    expect(akt1.map((r) => [r.key, r.value])).toEqual([
      ['function', 'Kinase in growth signalling.'],
      ['organism', 'Homo sapiens'],
      ['protein_name', 'RAC-alpha serine/threonine-protein kinase'],
      ['subcellular_location', 'Cytoplasm; Nucleus'],
    ]);
    expect(akt1.every((r) => r.gene_symbol === 'AKT1' && r.source_release === '2026_04' && r.retrieved_at)).toBe(true);

    const audit = await t.db
      .selectFrom('audit_log')
      .select(['reason', 'after'])
      .where('action', '=', 'reference.uniprot_refresh')
      .executeTakeFirstOrThrow();
    expect(audit.reason).toBe('monthly refresh');
    expect(audit.after).toMatchObject({ release: '2026_04', updated: 2 });
  });

  it('UNI-02: the protein page shows UniProt facts with their source and release', async () => {
    const res = await t.call(contributor, { method: 'GET', url: '/v1/proteins/P31749' });
    expect(res.statusCode, res.body).toBe(200);
    const page = res.json() as Json;
    expect(page.gene_symbol).toBe('AKT1');
    expect(page.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'function',
          value: 'Kinase in growth signalling.',
          source: 'UniProt',
          source_release: '2026_04',
          retrieved_at: expect.any(String),
        }),
      ]),
    );
  });

  it('UNI-01: a later refresh replaces the previous UniProt rows (kept, soft-deleted), never edits them', async () => {
    stub.setRelease('2026_05');
    const res = await refresh(admin);
    expect(res.statusCode, res.body).toBe(200);
    const current = await uniprotRows(false);
    expect(new Set(current.map((r) => r.source_release))).toEqual(new Set(['2026_05']));
    const previous = await uniprotRows(true);
    expect(previous.length).toBe(current.length);
    expect(new Set(previous.map((r) => r.source_release))).toEqual(new Set(['2026_04']));
  });

  it('UNI-01: when UniProt is unreachable the refresh fails and nothing changes', async () => {
    const before = await uniprotRows(false);
    stub.setDown(true);
    try {
      const res = await refresh(admin);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: 'uniprot_unavailable' });
    } finally {
      stub.setDown(false);
    }
    expect(await uniprotRows(false)).toEqual(before);
  });
});
