import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 28: compound structures (RDKit) and structure search, scoped to the programs the caller can read.
const TOLYL_BENZAMIDE = 'Cc1ccc(NC(=O)c2ccccc2)cc1';

describe('compound structures and search', () => {
  let t: TestApi;
  let program: string;
  let other: string;
  let chemist: string;
  let outsider: string;

  beforeAll(async () => {
    t = await startTestApi({});
    program = await t.program('CHM');
    other = await t.program('CHX');
    const user = await t.user('chm-chemist', { [program]: 'contributor' });
    chemist = user.token;
    outsider = (await t.user('chm-outsider', { [other]: 'contributor' })).token;
    const { tenant_id } = await t.db
      .selectFrom('program')
      .select('tenant_id')
      .where('id', '=', program)
      .executeTakeFirstOrThrow();
    const row = (program_id: string, compound_id: string, smiles: string | null, batch_id = 'B01') => ({
      tenant_id,
      created_by: user.id,
      program_id,
      compound_id,
      batch_id,
      name: `Compound ${compound_id}`,
      smiles,
      external_ids: '{}',
    });
    await t.db
      .insertInto('compound')
      .values([
        row(program, 'CHM-1', TOLYL_BENZAMIDE),
        row(program, 'CHM-1', TOLYL_BENZAMIDE, 'B02'), // a second batch: still one compound
        row(program, 'CHM-2', 'O=C(Nc1ccccc1)c1ccncc1'),
        row(program, 'CHM-3', 'COc1ccc(cc1)S(N)(=O)=O'),
        row(program, 'CHM-4', null),
        row(program, 'CHM-5', 'C1CC(not a smiles'),
        row(other, 'CHX-1', 'O=C(Nc1ccccc1)c1ccccc1'),
      ])
      .execute();
  }, 300_000);
  afterAll(() => t.close());

  const structure = (token: string, id: string) =>
    t.call(token, { method: 'GET', url: `/v1/compounds/${id}/structure` });
  const search = (token: string, payload: Json) =>
    t.call(token, { method: 'POST', url: '/v1/compounds/search', payload });

  it('CHEM-01: a structure has a depiction, canonical SMILES, InChIKey and descriptors', async () => {
    const res = await structure(chemist, 'CHM-1');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.svg).toContain('<svg');
    expect(body.smiles).toBe(TOLYL_BENZAMIDE);
    expect(body.inchikey).toBe('YUIHXKGKVSVIEL-UHFFFAOYSA-N');
    expect(body.descriptors.mw).toBeCloseTo(211.26, 1);
    expect(body.descriptors).toMatchObject({ hbd: 1, hba: 1, rings: 2 });
    expect(body.rdkit_version).toMatch(/^20\d\d\./);
    expect((await structure(outsider, 'CHM-1')).statusCode).toBe(404);
    expect((await structure(chemist, 'NOPE')).statusCode).toBe(404);
    const none = await structure(chemist, 'CHM-4');
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ code: 'no_structure' });
    const bad = await structure(chemist, 'CHM-5');
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: 'invalid_structure' });
  });

  it('CHEM-02: substructure search finds readable compounds holding the query, with the match', async () => {
    const res = await search(chemist, { query: 'c1ccccc1NC(=O)', mode: 'substructure' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.items.map((h: Json) => h.compound_id)).toEqual(['CHM-1', 'CHM-2']);
    expect(body.items[0].match_atoms.length).toBeGreaterThan(0);
    expect(body.items[0].svg).toContain('<svg');
    expect(body.items[0].similarity).toBeNull();
    expect(body).toMatchObject({
      searched: 3,
      no_structure: 1,
      total_hits: 2,
    });
    expect(body.invalid_structures).toEqual([
      expect.objectContaining({ program_code: 'CHM', compound_id: 'CHM-5', batch_id: 'B01' }),
    ]);
    // Another program's compound with the same substructure is not visible.
    const theirs = (await search(outsider, { query: 'c1ccccc1NC(=O)', mode: 'substructure' })).json() as Json;
    expect(theirs.items.map((h: Json) => h.compound_id)).toEqual(['CHX-1']);
    expect(
      (await search(chemist, { query: 'c1ccccc1NC(=O)', mode: 'substructure', program_id: other }))
        .statusCode,
    ).toBe(403);
    const invalid = await search(chemist, { query: 'C1CC(', mode: 'substructure' });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({ code: 'invalid_query', field: 'query' });
    const limited = (
      await search(chemist, { query: 'c1ccccc1NC(=O)', mode: 'substructure', limit: 1 })
    ).json() as Json;
    expect(limited).toMatchObject({ total_hits: 2 });
    expect(limited.items).toHaveLength(1);
  });

  it('CHEM-03: similarity search ranks by Tanimoto on the Morgan fingerprint, above a threshold', async () => {
    const res = await search(chemist, { query: TOLYL_BENZAMIDE, mode: 'similarity', min_similarity: 0.3 });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.items[0]).toMatchObject({ compound_id: 'CHM-1', similarity: 1, match_atoms: [] });
    const sims = body.items.map((h: Json) => h.similarity as number);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
    expect(sims.every((s: number) => s >= 0.3 && s <= 1)).toBe(true);
    expect(body.provenance).toMatchObject({ mode: 'similarity', min_similarity: 0.3 });
    expect(body.provenance.method).toMatch(/Morgan.*radius 2.*2048.*Tanimoto/);
    const exact = (
      await search(chemist, { query: TOLYL_BENZAMIDE, mode: 'similarity', min_similarity: 1 })
    ).json() as Json;
    expect(exact.items.map((h: Json) => h.compound_id)).toEqual(['CHM-1']);
    const invalid = await search(chemist, { query: '[[[', mode: 'similarity' });
    expect(invalid.json()).toMatchObject({ code: 'invalid_query', field: 'query' });
  });
});
