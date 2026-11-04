import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 28 (chemistry review): batches, programs, salts, SMILES vs SMARTS queries and descriptor definitions.
describe('compound structures: batches, programs and definitions', () => {
  let t: TestApi;
  let a: string;
  let b: string;
  let chemist: string;

  beforeAll(async () => {
    t = await startTestApi({});
    a = await t.program('CSA');
    b = await t.program('CSB');
    const user = await t.user('cs-chemist', { [a]: 'contributor', [b]: 'contributor' });
    chemist = user.token;
    const { tenant_id } = await t.db
      .selectFrom('program')
      .select('tenant_id')
      .where('id', '=', a)
      .executeTakeFirstOrThrow();
    const row = (program_id: string, compound_id: string, batch_id: string, smiles: string) => ({
      tenant_id,
      created_by: user.id,
      program_id,
      compound_id,
      batch_id,
      name: null,
      smiles,
      external_ids: '{}',
    });
    await t.db
      .insertInto('compound')
      .values([
        // Batches of one compound with different registered structures (B10 sorts after B2 numerically).
        row(a, 'CS-1', 'B2', 'Cc1ccc(NC(=O)c2ccccc2)cc1'),
        row(a, 'CS-1', 'B10', 'Cc1ccc(NC(=O)c2ccccc2)cc1Cl'),
        // A salt: two components.
        row(a, 'CS-2', 'B1', 'CC(=O)Oc1ccccc1C(=O)[O-].[Na+]'),
        // The same compound_id in another program, another structure.
        row(b, 'CS-1', 'B1', 'OC(=O)c1ccccc1'),
        // Text after a space is not part of a SMILES.
        row(a, 'CS-3', 'B1', 'c1ccccc1 benzene'),
      ])
      .execute();
  }, 300_000);
  afterAll(() => t.close());

  const structure = (id: string, query = '') =>
    t.call(chemist, { method: 'GET', url: `/v1/compounds/${id}/structure${query}` });
  const search = (payload: Json) => t.call(chemist, { method: 'POST', url: '/v1/compounds/search', payload });

  it('CHEM-01: Lipinski counts are reported apart from RDKit donor/acceptor counts; salts are flagged', async () => {
    const one = (await structure('CS-1', `?program_id=${a}&batch_id=B2`)).json() as Json;
    expect(one.descriptors).toMatchObject({ hbd: 1, hba: 1, lipinski_hbd: 1, lipinski_hba: 2 });
    expect(one.components).toBe(1);
    const salt = (await structure('CS-2', `?program_id=${a}`)).json() as Json;
    expect(salt.components).toBe(2);
  });

  it('CHEM-01: a compound in two readable programs needs a program; batches with different structures are listed', async () => {
    const ambiguous = await structure('CS-1');
    expect(ambiguous.statusCode).toBe(422);
    expect(ambiguous.json()).toMatchObject({ code: 'ambiguous_compound', field: 'program_id' });
    const other = (await structure('CS-1', `?program_id=${b}`)).json() as Json;
    expect(other.smiles).toBe('OC(=O)c1ccccc1');
    const first = (await structure('CS-1', `?program_id=${a}`)).json() as Json;
    expect(first.batch_id).toBe('B2'); // numeric-aware: B2 before B10
    expect(first.batches_differ).toBe(true);
    expect(first.batches.map((x: Json) => x.batch_id)).toEqual(['B2', 'B10']);
    const b10 = (await structure('CS-1', `?program_id=${a}&batch_id=B10`)).json() as Json;
    expect(b10.smiles).toContain('Cl');
  });

  it('CHEM-02: every distinct batch structure is searched; SMILES queries are read as SMILES; stereo is stated', async () => {
    const chloro = (await search({ query: 'c1cc(Cl)ccc1N', mode: 'substructure' })).json() as Json;
    expect(chloro.items.map((h: Json) => [h.program_code, h.compound_id, h.batch_ids])).toEqual([
      ['CSA', 'CS-1', ['B10']],
    ]);
    expect(chloro.items[0].batches_differ).toBe(true);
    // Kekulé benzene: no hit as SMARTS (aliphatic C=C), every benzene ring as SMILES.
    const smarts = (await search({ query: 'C1=CC=CC=C1', mode: 'substructure' })).json() as Json;
    expect(smarts.items).toHaveLength(0);
    const smiles = (
      await search({ query: 'C1=CC=CC=C1', mode: 'substructure', query_type: 'smiles' })
    ).json() as Json;
    expect(smiles.items.length).toBeGreaterThanOrEqual(3);
    expect(smiles.provenance.method).toMatch(/SMILES/);
    expect(smiles.provenance.method).toMatch(/stereochemistry ignored/);
    expect(smiles.items[0].matches).toBeGreaterThanOrEqual(1);
    // Registered text after a space is listed as unreadable, with its program and batch.
    expect(smiles.invalid_structures).toEqual([
      expect.objectContaining({ program_code: 'CSA', compound_id: 'CS-3', batch_id: 'B1' }),
    ]);
    const spaced = await search({ query: 'c1ccccc1 benzene', mode: 'similarity' });
    expect(spaced.statusCode).toBe(400);
  });
});
