import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// One program profiles CPD-000001 three ways (all synthetic fixtures):
// - CurveCurator curves (ONC-DIA-01/curves.txt; accessions, no gene names): TUBB (P07437) regulated, pEC50 8.22;
//   TP53 (P04637) tested, not regulated.
// - A TPP-TR table (tools/tpp/tr_results.tsv; gene symbols) imported for CPD-000001: TP53, AKT1 and EGFR stabilised,
//   KRAS destabilised, all with adjusted p < 0.05.
// - Target annotations: TP53 primary target, KRAS off-target (reference/compound_targets.tsv), and
//   reference/target_annotations.tsv, which maps gene symbols to accessions.
const CURVES = '../ONC-DIA-01/curves.txt';
const TPP = '../../tools/tpp/tr_results.tsv';
const LABELS = ['126', '127L', '127H', '128L', '128H', '129L', '129H', '130L', '130H', '131L'];
const TEMPS = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67];
const curveOptions = {
  compound_id: 'CPD-000001',
  doses: [0, 1, 10, 100, 1000, 10000],
  dose_scale: 1e-9,
  dose_unit: 'M',
};
const tppOptions = {
  compound_id: 'CPD-000001',
  feature_type: 'gene',
  temperatures: Object.fromEntries(LABELS.map((l, i) => [l, TEMPS[i]])),
};

describe('compound target evidence API', () => {
  let t: TestApi;
  let token: string;
  let outsider: string;
  let program: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('EVD');
    const other = await t.program('EVX');
    token = (await t.user('evd-user', { [program]: 'contributor' })).token;
    outsider = (await t.user('evd-outsider', { [other]: 'viewer' })).token;
    await publishedDaRelease(t, token, program, 'CPD-000001 profiling', {
      file: CURVES,
      importer: 'curvecurator',
      importOptions: curveOptions,
      extra: [{ file: TPP, importer: 'tpp_tr', datasetName: 'CPD-000001 TPP-TR', importOptions: tppOptions }],
    });
    await publishedDaRelease(t, token, program, 'Compound targets', {
      file: '../../reference/compound_targets.tsv',
      importer: 'reference_target_annotation',
    });
    await publishedDaRelease(t, token, program, 'Protein annotations', {
      file: '../../reference/target_annotations.tsv',
      importer: 'reference_target_annotation',
    });
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string, as = token) => t.call(as, { method: 'GET', url });
  const find = (body: Json, gene: string) => body.proteins.find((p: Json) => p.gene === gene);

  it('EVD-01: lines up dose-response, thermal shift and annotation per protein, against stated thresholds', async () => {
    const res = await get('/v1/compounds/CPD-000001/target-evidence');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body).toMatchObject({
      compound_id: 'CPD-000001',
      program_id: program,
      thresholds: { pec50_min: 6, adj_p_max: 0.05 },
    });
    expect(body.sources.dose_response).toHaveLength(1);
    expect(body.sources.thermal_shift).toHaveLength(1);
    const tp53 = find(body, 'TP53');
    expect(tp53).toMatchObject({
      accession: 'P04637',
      annotation: 'primary_target',
      lines: { annotation: true, thermal: true, dose: false },
    });
    expect(tp53.dose).toBeNull(); // tested, not regulated: no dose-response evidence
    expect(tp53.thermal.map((x: Json) => x.comparison).sort()).toEqual([
      'CPD5_1 vs Vehicle_1',
      'CPD5_2 vs Vehicle_2',
    ]);
    expect(tp53.thermal[0].delta_tm).toBeGreaterThan(0);
    const kras = find(body, 'KRAS');
    expect(kras).toMatchObject({ annotation: 'off_target', lines: { thermal: true } });
    expect(kras.thermal.every((x: Json) => x.delta_tm < 0)).toBe(true); // destabilised
    const tubb = body.proteins.find((p: Json) => p.accession === 'P07437');
    expect(tubb).toMatchObject({ lines: { dose: true }, dose: { regulation: expect.any(String) } });
    expect(tubb.dose.pec50).toBeCloseTo(8.22, 1);
    // Gene symbols from the TPP table are matched to accessions through the target annotations; the match is shown.
    expect(find(body, 'AKT1')).toMatchObject({
      accession: 'P31749',
      matched_by: 'gene symbol via target annotations',
    });
    expect(body.notes.join(' ')).toMatch(/no combined score/i);
  });

  it('EVD-01: ordered by lines of evidence, then potency; thresholds change which lines count', async () => {
    const body = (await get('/v1/compounds/CPD-000001/target-evidence')).json() as Json;
    const counts = body.proteins.map((p: Json) => Object.values(p.lines).filter(Boolean).length);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(counts.every((n: number) => n >= 1)).toBe(true); // proteins without any evidence are not listed
    const strict = (
      await get('/v1/compounds/CPD-000001/target-evidence?adj_p_max=0.0001&pec50_min=9')
    ).json() as Json;
    expect(find(strict, 'AKT1')).toBeUndefined();
    expect(find(strict, 'TP53')).toMatchObject({ lines: { thermal: false, annotation: true } });
    expect((await get('/v1/compounds/CPD-000001/target-evidence?pec50_min=20')).statusCode).toBe(400);
  });

  it('EVD-01: only readable programs, and nothing for a compound without evidence', async () => {
    const hidden = (await get('/v1/compounds/CPD-000001/target-evidence', outsider)).json() as Json;
    expect(hidden).toMatchObject({ program_id: null, proteins: [] });
    const none = (await get('/v1/compounds/CPD-999999/target-evidence')).json() as Json;
    expect(none.proteins).toEqual([]);
  });
});
