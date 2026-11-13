import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// CurveCurator curves (fixtures/experiments/ONC-DIA-01/curves.txt): 157 proteins; 138 classed (16 regulated:
// 11 down, 5 up, all with a pEC50; 122 not), 19 left without a class. Doses 1 nM–10 µM (plus a control).
// TP53 (P04637), CPD-000001's annotated primary target, is "not" regulated.
const options = (compound: string) => ({
  compound_id: compound,
  doses: [0, 1, 10, 100, 1000, 10000],
  dose_scale: 1e-9,
  dose_unit: 'M',
});
const CURVES = '../ONC-DIA-01/curves.txt';

describe('compound selectivity API', () => {
  let t: TestApi;
  let token: string;
  let outsider: string;
  let version: string;
  let releaseB: string;
  let programY: string;
  let both: string;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    const program = await t.program('SEL');
    const other = await t.program('SEX');
    token = (await t.user('sel-user', { [program]: 'contributor' })).token;
    outsider = (await t.user('sel-outsider', { [other]: 'viewer' })).token;
    // One profiling experiment, one dose-response dataset per compound (CurveCurator takes one compound per file).
    const made = await publishedDaRelease(t, token, program, 'Selectivity A', {
      file: CURVES,
      importer: 'curvecurator',
      importOptions: options('CPD-000001'),
      extra: [
        {
          file: CURVES,
          importer: 'curvecurator',
          datasetName: 'CPD-000002 curves',
          importOptions: options('CPD-000002'),
        },
      ],
    });
    version = made.version;
    releaseB = made.extra[0]!;
    // Compound → target links are a reference dataset (as on the compound page's Targets table): TP53 (P04637) is
    // CPD-000001's annotated primary target, KRAS (P01116) an off-target.
    await publishedDaRelease(t, token, program, 'Selectivity targets', {
      file: '../../reference/compound_targets.tsv',
      importer: 'reference_target_annotation',
    });
    // A second program with its own CPD-000001 and a different primary-target annotation.
    programY = await t.program('SEY');
    const y = (await t.user('sel-y', { [programY]: 'contributor', [program]: 'contributor' })).token;
    await publishedDaRelease(t, y, programY, 'Selectivity Y', {
      file: CURVES,
      importer: 'curvecurator',
      importOptions: options('CPD-000001'),
    });
    await publishedDaRelease(t, y, programY, 'Selectivity Y targets', {
      bytes: Buffer.from(
        'uniprot_accession\tgene_symbol\tfamily\tkey\tvalue\nP07437\tTUBB\tcytoskeleton\tprimary_target\tCPD-000001\n',
      ),
      file: '../../reference/compound_targets.tsv',
      importer: 'reference_target_annotation',
    });
    both = y; // reads both programs
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string, as = token) => t.call(as, { method: 'GET', url });

  it('SEL-02: the profile of a compound in its profiling experiment: tested, regulated, S(x), window and a ranked figure', async () => {
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
    expect(p.tested).toBe(138);
    expect(p.unclassified).toBe(19);
    expect(p.regulated).toBe(16);
    expect([p.regulated_down, p.regulated_up]).toEqual([11, 5]);
    expect(p.s_score).toMatchObject({ pec50_min: 6, ec50_max_molar: 1e-6, direction: 'both', tested: 138 });
    expect(p.s_score.score).toBeCloseTo(p.s_score.regulated / 138, 10);
    expect(p.window).toMatchObject({
      delta: null,
      note: 'No annotated primary target is regulated in this experiment.',
    });
    expect(p.proteins).toHaveLength(16);
    const pec50s = p.proteins.map((x: Json) => x.pec50);
    expect([...pec50s].sort((a: number, b: number) => b - a)).toEqual(pec50s); // most potent first
    expect(p.dose_range).toEqual({ pec50_low: 5, pec50_high: 9 });
    expect(body.figure.data[0].type).toBe('scatter');
    expect(body.provenance.notes.join(' ')).toMatch(/apparent potency in this assay, not a binding constant/);
  });

  it('SEL-02: one experiment with a dose-response dataset per compound profiles the right dataset', async () => {
    const body = (await get('/v1/compounds/CPD-000002/selectivity')).json() as Json;
    expect(body.experiments).toHaveLength(1);
    expect(body.experiments[0]).toMatchObject({ release_id: releaseB, dataset_name: 'CPD-000002 curves' });
    expect(body.provenance.release_id).toBe(releaseB);
    expect(body.profile.tested).toBe(138);
    const chosen = (await get(`/v1/compounds/CPD-000002/selectivity?release_id=${releaseB}`)).json() as Json;
    expect(chosen.provenance.release_id).toBe(releaseB);
  });

  it('SEL-02: direction, a stricter threshold, and thresholds outside 3–12 refused; outside the dose range noted', async () => {
    const s = async (q: string) =>
      ((await get(`/v1/compounds/CPD-000001/selectivity?${q}`)).json() as Json).profile.s_score;
    expect((await s('pec50_min=7.5')).regulated).toBeLessThanOrEqual((await s('pec50_min=5')).regulated);
    const down = await s('pec50_min=5&direction=down');
    expect(down).toMatchObject({ direction: 'down' });
    expect(down.regulated).toBeLessThanOrEqual(11);
    const bad = await get('/v1/compounds/CPD-000001/selectivity?pec50_min=20');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ field: 'pec50_min' });
    const far = (await get('/v1/compounds/CPD-000001/selectivity?pec50_min=11')).json() as Json;
    expect(far.profile.notes.join(' ')).toContain('outside the tested dose range');
  });

  it('SEL-02: only readable experiments count; a compound without profiling data has no profile', async () => {
    const hidden = (await get('/v1/compounds/CPD-000001/selectivity', outsider)).json() as Json;
    expect(hidden).toMatchObject({ experiments: [], version_id: null, profile: null, figure: null });
    const none = (await get('/v1/compounds/CPD-999999/selectivity')).json() as Json;
    expect(none.experiments).toEqual([]);
  });

  it('SEL-04: the selectivity table has one row per compound and profiling dataset, with counts, S(x) and flags', async () => {
    const res = await get('/v1/selectivity?pec50_min=6', both);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    const inSel = body.items.filter((x: Json) => x.program_code === 'SEL');
    expect(inSel.map((x: Json) => x.compound_id).sort()).toEqual(['CPD-000001', 'CPD-000002']);
    const b = inSel.find((x: Json) => x.compound_id === 'CPD-000002');
    expect(b).toMatchObject({
      release_id: releaseB,
      dataset_name: 'CPD-000002 curves',
      experiment_name: 'Selectivity A',
      method: 'CurveCurator',
      tested: 138,
      regulated: 16,
      regulated_down: 11,
      regulated_up: 5,
      status: 'ranked',
      flags: ['19 curves without a class from the tool are not counted as tested.'],
    });
    expect(b.s_score).toBeCloseTo(b.s_regulated / 138, 10);
    // Each compound has an annotated primary target (TP53, EGFR); neither is regulated in these curves.
    for (const item of inSel)
      expect(item.window_note).toBe('No annotated primary target is regulated in this experiment.');
    expect(body.thresholds).toEqual({ pec50_min: 6, ec50_max_molar: 1e-6, direction: 'both' });
    expect(((await get('/v1/selectivity', outsider)).json() as Json).items).toEqual([]);
  });

  it('SEL-04: target annotations are per program (compound IDs are unique within a program only)', async () => {
    const body = (await get('/v1/selectivity', both)).json() as Json;
    const other = body.items.find((x: Json) => x.program_code === 'SEY');
    // In SEY, CPD-000001's annotated primary target is P07437, the most potent regulated protein (pEC50 8.22).
    expect(other).toMatchObject({ compound_id: 'CPD-000001', primary: { feature_id: 'P07437' } });
    expect(other.window_delta).toBeGreaterThan(0);
    const sel = body.items.find((x: Json) => x.program_code === 'SEL' && x.compound_id === 'CPD-000001');
    expect(sel.primary).toBeNull(); // SEL's annotation (TP53) is not SEY's
    const one = (await get(`/v1/selectivity?program_id=${programY}`, both)).json() as Json;
    expect(one.items.map((x: Json) => x.program_code)).toEqual(['SEY']);
    // The compound's own profile uses its dataset's program too.
    const profile = (
      await get(`/v1/compounds/CPD-000001/selectivity?release_id=${other.release_id}`, both)
    ).json() as Json;
    expect(profile.profile.window.primary).toMatchObject({ feature_id: 'P07437' });
  });

  it('SEL-04: a threshold outside the tested doses is flagged on the row; an inactive compound is not ranked', async () => {
    const far = (await get('/v1/selectivity?pec50_min=11', both)).json() as Json;
    for (const item of far.items) {
      expect(item.status).toBe('inactive');
      expect(item.flags.join(' ')).toContain('outside the tested dose range');
    }
  });
});
