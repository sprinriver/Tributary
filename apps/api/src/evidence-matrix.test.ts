import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// One program: the same synthetic curves file imported for CPD-000001 and for CPD-000002, a TPP-TR table for
// CPD-000001 only, and target annotations (TP53 primary / KRAS off-target for CPD-000001; EGFR primary / BRAF
// off-target for CPD-000002). The matrix uses the compound page's rules (shared builder).
const LABELS = ['126', '127L', '127H', '128L', '128H', '129L', '129H', '130L', '130H', '131L'];
const TEMPS = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67];
const curves = (compound: string) => ({
  compound_id: compound,
  doses: [0, 1, 10, 100, 1000, 10000],
  dose_scale: 1e-9,
  dose_unit: 'M',
});

describe('compound × protein evidence matrix', () => {
  let t: TestApi;
  let token: string;
  let outsider: string;
  let program: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('MTX');
    const other = await t.program('MTY');
    token = (await t.user('mtx-user', { [program]: 'contributor' })).token;
    outsider = (await t.user('mtx-outsider', { [other]: 'viewer' })).token;
    await publishedDaRelease(t, token, program, 'Series profiling', {
      file: '../ONC-DIA-01/curves.txt',
      importer: 'curvecurator',
      importOptions: curves('CPD-000001'),
      extra: [
        {
          file: '../ONC-DIA-01/curves.txt',
          importer: 'curvecurator',
          datasetName: 'CPD-000002 curves',
          importOptions: curves('CPD-000002'),
        },
        {
          file: '../../tools/tpp/tr_results.tsv',
          importer: 'tpp_tr',
          datasetName: 'CPD-000001 TPP-TR',
          importOptions: {
            compound_id: 'CPD-000001',
            feature_type: 'gene',
            temperatures: Object.fromEntries(LABELS.map((l, i) => [l, TEMPS[i]])),
          },
        },
      ],
    });
    for (const [name, file] of [
      ['Compound targets', 'compound_targets.tsv'],
      ['Protein annotations', 'target_annotations.tsv'],
    ])
      await publishedDaRelease(t, token, program, name!, {
        file: `../../reference/${file}`,
        importer: 'reference_target_annotation',
      });
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string, as = token) => t.call(as, { method: 'GET', url });

  it('EVD-03: compounds as columns, proteins with a measured line as rows, cells with each line', async () => {
    const res = await get('/v1/target-evidence/matrix');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body).toMatchObject({ program_id: program, thresholds: { pec50_min: 6, adj_p_max: 0.05 } });
    expect(body.compounds.map((c: Json) => c.compound_id)).toEqual(['CPD-000001', 'CPD-000002']);
    expect(body.compounds[0]).toMatchObject({ dose_datasets: 1, thermal_datasets: 1 });
    expect(body.compounds[1]).toMatchObject({ dose_datasets: 1, thermal_datasets: 0 });
    const row = (accession: string) => body.proteins.find((p: Json) => p.accession === accession);
    // TUBB: the same regulated curve for both compounds.
    const tubb = row('P07437');
    expect(tubb.cells['CPD-000001']).toMatchObject({ dose: true, thermal: false });
    expect(tubb.cells['CPD-000002']).toMatchObject({ dose: true });
    expect(tubb.cells['CPD-000001'].pec50).toBeCloseTo(8.22, 1);
    expect(tubb.measured_compounds).toBe(2);
    // TP53: thermal evidence and the primary-target annotation for CPD-000001 only.
    expect(row('P04637').cells['CPD-000001']).toMatchObject({
      thermal: true,
      direction: 'stabilised',
      annotation: 'primary_target',
    });
    // EGFR: thermal for CPD-000001; annotated primary target of CPD-000002 (shown on a row with a measured line).
    const egfr = row('P00533');
    expect(egfr.cells['CPD-000001']).toMatchObject({ thermal: true });
    expect(egfr.cells['CPD-000002']).toMatchObject({
      dose: false,
      thermal: false,
      annotation: 'primary_target',
    });
    const counts = body.proteins.map((p: Json) => p.measured_compounds);
    expect([...counts].sort((a: number, b: number) => b - a)).toEqual(counts);
    expect(body.notes.join(' ')).toMatch(/no combined score/i);
  });

  it('EVD-03: thresholds change the cells; limits are stated; only readable programs', async () => {
    const strict = (await get('/v1/target-evidence/matrix?pec50_min=9')).json() as Json;
    expect(strict.proteins.find((p: Json) => p.accession === 'P07437')).toBeUndefined();
    const small = (await get('/v1/target-evidence/matrix?max_proteins=3')).json() as Json;
    expect(small.proteins).toHaveLength(3);
    expect(small.truncated.proteins).toBeGreaterThan(0);
    expect(small.notes.join(' ')).toMatch(/first 3 proteins/);
    expect((await get('/v1/target-evidence/matrix?max_proteins=0')).statusCode).toBe(400);
    const hidden = (await get('/v1/target-evidence/matrix', outsider)).json() as Json;
    expect(hidden).toMatchObject({ program_id: null, compounds: [], proteins: [] });
  });
});
