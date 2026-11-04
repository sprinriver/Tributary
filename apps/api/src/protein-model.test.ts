import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 29: protein 3D models from a local directory (the synthetic demo models in fixtures/structures) or
// AlphaFold DB, always served by the API (same origin).
const AFDB = 'https://afdb.test';
const CIF = 'data_AF-P04637-F1\n_entry.id AF-P04637-F1\n#\n';

function afdbStub() {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url === `${AFDB}/api/prediction/P04637`)
      return Response.json([
        { entryId: 'AF-P04637-F1', cifUrl: `${AFDB}/files/AF-P04637-F1-model_v6.cif`, latestVersion: 6 },
      ]);
    if (url === `${AFDB}/files/AF-P04637-F1-model_v6.cif`) return new Response(CIF);
    if (url === `${AFDB}/api/prediction/P12345`)
      return Response.json([{ entryId: 'AF-P12345-F1', cifUrl: 'https://elsewhere.test/x.cif' }]);
    return new Response('[]', { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('protein 3D models', () => {
  let t: TestApi;
  let token: string;
  const stub = afdbStub();

  beforeAll(async () => {
    t = await startTestApi({
      fetch: stub.fetchImpl,
      config: { proteinModels: { dir: '', alphafoldUrl: AFDB } },
    });
    const program = await t.program('STR');
    token = (await t.user('str-user', { [program]: 'viewer' })).token;
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string, auth = token) => t.call(auth, { method: 'GET', url });

  it('STRUC-01: a local model is served from the same origin with its pLDDT metric', async () => {
    const local = await startTestApi({}); // dev default: fixtures/structures (synthetic demo models)
    try {
      const program = await local.program('STL');
      const user = await local.user('stl-user', { [program]: 'viewer' });
      const res = await local.call(user.token, { method: 'GET', url: '/v1/proteins/SYNP0053/model' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        accession: 'SYNP0053',
        source: 'local',
        model_path: '/v1/proteins/SYNP0053/model.cif',
        predicted: true,
        confidence_metric: 'pLDDT',
      });
      const file = await local.call(user.token, { method: 'GET', url: '/v1/proteins/SYNP0053/model.cif' });
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toMatch(/mmcif/);
      expect(file.body.startsWith('data_SYNP0053\n')).toBe(true);
    } finally {
      await local.close();
    }
  });

  it('STRUC-01: an AlphaFold DB model is fetched by the API, labelled as predicted, and cached', async () => {
    const res = await get('/v1/proteins/P04637/model');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      accession: 'P04637',
      source: 'alphafold_db',
      entry_id: 'AF-P04637-F1',
      predicted: true,
      confidence_metric: 'pLDDT',
      licence: expect.stringMatching(/CC BY 4\.0/),
    });
    const file = await get('/v1/proteins/P04637/model.cif');
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe(CIF);
    await get('/v1/proteins/P04637/model.cif');
    expect(stub.calls.filter((u) => u.endsWith('.cif')).length).toBe(1); // second read from the cache
  });

  it('STRUC-01: files on other hosts are refused; unknown, invalid and anonymous requests are not served', async () => {
    const untrusted = await get('/v1/proteins/P12345/model.cif');
    expect(untrusted.statusCode).toBe(502);
    expect(untrusted.json()).toMatchObject({ code: 'untrusted_model_url' });
    expect(stub.calls).not.toContain('https://elsewhere.test/x.cif');
    const missing = await get('/v1/proteins/Q99999/model');
    expect(missing.statusCode).toBe(404);
    const invalid = await get('/v1/proteins/..%2Fetc%2Fpasswd/model');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'invalid_accession' });
    // Synthetic accessions are not UniProt accessions: never sent to AlphaFold DB.
    const synthetic = await get('/v1/proteins/SYNP0053/model');
    expect(synthetic.statusCode).toBe(404);
    expect(stub.calls.some((u) => u.includes('SYNP0053'))).toBe(false);
    expect((await t.app.inject({ method: 'GET', url: '/v1/proteins/P04637/model' })).statusCode).toBe(401);
  });
});
