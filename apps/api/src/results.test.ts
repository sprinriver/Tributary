import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { CONTRAST, publishedDaRelease, topTable } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('results pages API', () => {
  let t: TestApi;
  let program: string;
  let token: string;
  let a: { version: string; release: string };
  let b: { version: string; release: string };

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('RES');
    const user = await t.user('res-user', { [program]: 'contributor' });
    token = user.token;
    a = await publishedDaRelease(t, token, program, 'Results A');
    b = await publishedDaRelease(t, token, program, 'Results B');
    const { tenant_id } = await t.db
      .selectFrom('program')
      .select('tenant_id')
      .where('id', '=', program)
      .executeTakeFirstOrThrow();
    const base = { tenant_id, created_by: user.id };
    await t.db
      .insertInto('compound')
      .values({
        ...base,
        compound_id: 'CPD-000005',
        name: 'Demo compound 5',
        smiles: 'CCO',
        external_ids: '{}',
        program_id: program,
      })
      .execute();
    await t.db
      .insertInto('compound_property')
      .values([
        {
          ...base,
          program_id: program,
          compound_id: 'CPD-000005',
          property: 'logD7.4',
          value: 2.5,
          unit: null,
          qualifier: '=',
          assay_category: 'physchem',
          assay_name: 'Shake-flask logD',
        },
        {
          ...base,
          program_id: program,
          compound_id: 'CPD-000005',
          property: 'CLint',
          value: 12,
          unit: 'µL/min/mg',
          qualifier: '=',
          assay_category: 'ADME',
          assay_name: 'HLM CLint',
        },
      ])
      .execute();
    await t.db
      .insertInto('target_annotation')
      .values({
        ...base,
        uniprot_accession: 'P31749',
        gene_symbol: 'AKT1',
        family: 'signalling',
        key: 'subcellular_location',
        value: 'cytoplasm',
      })
      .execute();
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string) => t.call(token, { method: 'GET', url });

  it('RES-01: a version’s results — releases by kind, contrasts and a deterministic methods paragraph', async () => {
    const res = await get(`/v1/versions/${a.version}/results`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.releases).toEqual([
      expect.objectContaining({ id: a.release, kind: 'differential_abundance', importer: 'limma_toptable' }),
    ]);
    expect(body.contrasts).toEqual([
      expect.objectContaining({ label: CONTRAST.label, numerator: CONTRAST.numerator }),
    ]);
    expect(body.run).toBeNull();
    expect(body.methods).toContain(CONTRAST.label);
    expect(body.methods).toContain('imported from tool outputs (no pipeline run recorded)');
    expect(body.methods).toBe((await get(`/v1/versions/${a.version}/results`)).json().methods);
  });

  it('RES-04: a compound — properties/ADME, and the contrasts (with releases) where it was the treatment', async () => {
    const res = await get('/v1/compounds/CPD-000005');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.compound).toMatchObject({ compound_id: 'CPD-000005', name: 'Demo compound 5' });
    expect(body.properties.map((p: Json) => p.property).sort()).toEqual(['CLint', 'logD7.4']);
    expect(body.contrasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          experiment_version_id: a.version,
          label: CONTRAST.label,
          release_id: a.release,
        }),
        expect.objectContaining({ experiment_version_id: b.version, release_id: b.release }),
      ]),
    );
    expect((await get('/v1/compounds/CPD-999999')).statusCode).toBe(404);
  });

  it('RES-03: a protein — reference annotations', async () => {
    const body = (await get('/v1/proteins/P31749')).json() as Json;
    expect(body).toMatchObject({ accession: 'P31749', gene_symbol: 'AKT1' });
    expect(body.annotations).toEqual([
      expect.objectContaining({ key: 'subcellular_location', value: 'cytoplasm' }),
    ]);
  });

  it('RES-05: comparing contrasts — log2_fc scatter, overlap table and intersection bars', async () => {
    const res = await t.call(token, {
      method: 'POST',
      url: '/v1/compare',
      payload: {
        contrasts: [
          {
            release_id: a.release,
            contrast_id: (await get(`/v1/versions/${a.version}/results`)).json().contrasts[0].id,
          },
          {
            release_id: b.release,
            contrast_id: (await get(`/v1/versions/${b.version}/results`)).json().contrasts[0].id,
          },
        ],
        fc_threshold: 1,
        p_threshold: 0.05,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    const hits = topTable().filter((r) => Math.abs(r.logFC) >= 1 && r.adjP <= 0.05).length;
    expect(body.labels).toHaveLength(2);
    // Both releases hold the same table: every hit is shared.
    expect(body.intersections).toEqual([expect.objectContaining({ members: [true, true], count: hits })]);
    expect(body.overlap.filter((r: Json) => r.significant.every(Boolean))).toHaveLength(hits);
    const scatter = body.scatter.data[0];
    expect(scatter.x).toEqual(scatter.y);
    expect(body.upset.data.some((tr: Json) => tr.type === 'bar')).toBe(true);
    const tooMany = await t.call(token, {
      method: 'POST',
      url: '/v1/compare',
      payload: { contrasts: [], fc_threshold: 1, p_threshold: 0.05 },
    });
    expect(tooMany.statusCode).toBe(400);
  });
});
