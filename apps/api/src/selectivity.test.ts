import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// CurveCurator curves of CPD-000001 (fixtures/experiments/ONC-DIA-01/curves.txt): 157 proteins, 16 regulated
// (11 down, 5 up), all with a pEC50; TP53 (P04637), the compound's annotated primary target, is "not" regulated.
const CURVES = {
  file: '../ONC-DIA-01/curves.txt',
  importer: 'curvecurator',
  importOptions: {
    compound_id: 'CPD-000001',
    doses: [0, 1, 10, 100, 1000, 10000],
    dose_scale: 1e-9,
    dose_unit: 'M',
  },
};

describe('compound selectivity API', () => {
  let t: TestApi;
  let token: string;
  let outsider: string;
  let version: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    const program = await t.program('SEL');
    const other = await t.program('SEX');
    token = (await t.user('sel-user', { [program]: 'contributor' })).token;
    outsider = (await t.user('sel-outsider', { [other]: 'viewer' })).token;
    ({ version } = await publishedDaRelease(t, token, program, 'Selectivity A', CURVES));
    // Compound → target links are a reference dataset (as on the compound page's Targets table): TP53 (P04637) is
    // CPD-000001's annotated primary target, KRAS (P01116) an off-target.
    await publishedDaRelease(t, token, program, 'Selectivity targets', {
      file: '../../reference/compound_targets.tsv',
      importer: 'reference_target_annotation',
    });
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string, as = token) => t.call(as, { method: 'GET', url });

  it('SEL-02: the profile of a compound in its profiling experiment: tested, engaged, S(x), window and a ranked figure', async () => {
    const res = await get('/v1/compounds/CPD-000001/selectivity?pec50_min=6');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.experiments).toHaveLength(1);
    expect(body.experiments[0]).toMatchObject({
      version_id: version,
      experiment_name: 'Selectivity A',
      method: 'CurveCurator',
    });
    expect(body.version_id).toBe(version);
    const p = body.profile;
    expect(p.tested).toBe(157);
    expect(p.engaged).toBe(16);
    expect(p.s_score).toMatchObject({ pec50_min: 6, ec50_max_molar: 1e-6, tested: 157 });
    expect(p.s_score.score).toBeCloseTo(p.s_score.engaged / 157, 10);
    expect(p.window).toMatchObject({
      delta: null,
      note: 'No annotated primary target is engaged in this experiment.',
    });
    expect(p.proteins).toHaveLength(16);
    const pec50s = p.proteins.map((x: Json) => x.pec50);
    expect([...pec50s].sort((a: number, b: number) => b - a)).toEqual(pec50s); // most potent first
    expect(body.figure.data[0].type).toBe('scatter');
    expect(body.provenance.notes.join(' ')).toMatch(/apparent cellular potency, not a binding constant/);
  });

  it('SEL-02: a stricter threshold engages fewer proteins; thresholds outside 3–12 are refused', async () => {
    const lax = ((await get('/v1/compounds/CPD-000001/selectivity?pec50_min=5')).json() as Json).profile
      .s_score;
    const strict = ((await get('/v1/compounds/CPD-000001/selectivity?pec50_min=7.5')).json() as Json).profile
      .s_score;
    expect(strict.engaged).toBeLessThanOrEqual(lax.engaged);
    const bad = await get('/v1/compounds/CPD-000001/selectivity?pec50_min=20');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ field: 'pec50_min' });
  });

  it('SEL-02: only readable experiments count; a compound without profiling data has no profile', async () => {
    const hidden = (await get('/v1/compounds/CPD-000001/selectivity', outsider)).json() as Json;
    expect(hidden).toMatchObject({ experiments: [], version_id: null, profile: null, figure: null });
    const none = (await get('/v1/compounds/CPD-999999/selectivity')).json() as Json;
    expect(none.experiments).toEqual([]);
  });
});
