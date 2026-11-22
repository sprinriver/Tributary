import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
/** curves.txt with the TUBB (P07437) row renamed to the protein group "P99999;P04637". */
const groupCurves = () =>
  readFileSync(join(FIXTURES, 'experiments/ONC-DIA-01/curves.txt'), 'utf8').replace(
    /^P07437\t/m,
    'P99999;P04637\t',
  );
/** The TPP table without TPP's replicate checks, with KRAS's second comparison at ΔTm +1.0 and adjusted p 0.4. */
function tppWithoutChecks() {
  const [head, ...lines] = readFileSync(join(FIXTURES, 'tools/tpp/tr_results.tsv'), 'utf8')
    .replace(/\n$/, '')
    .split('\n');
  const cols = head!.split('\t');
  const drop = cols.indexOf('fulfills_all_4_requirements');
  const [diff, p] = ['diff_meltP_CPD5_2_vs_Vehicle_2', 'pVal_adj_CPD5_2_vs_Vehicle_2'].map((c) =>
    cols.indexOf(c),
  );
  const edit = (l: string) => {
    const cells = l.split('\t');
    if (cells[0] === 'KRAS') [cells[diff!], cells[p!]] = ['1.0', '0.4'];
    return cells.filter((_, i) => i !== drop).join('\t');
  };
  return [cols.filter((_, i) => i !== drop).join('\t'), ...lines.map(edit)].join('\n') + '\n';
}

describe('compound target evidence API', () => {
  let t: TestApi;
  let token: string;
  let outsider: string;
  let program: string;
  let evf: string;
  let evm: string;
  let evfToken: string;
  let evmToken: string;

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
    // EVF: a TPP table without TPP's replicate checks (not a 2 × 2 design), where KRAS's second comparison is
    // opposite in sign and not significant; and curves where the regulated TUBB row is a protein group whose second
    // member is TP53, CPD-000001's annotated primary target.
    evf = await t.program('EVF');
    const f = (await t.user('evf-user', { [evf]: 'contributor' })).token;
    await publishedDaRelease(t, f, evf, 'CPD-000001 profiling F', {
      bytes: Buffer.from(groupCurves()),
      file: CURVES,
      importer: 'curvecurator',
      importOptions: curveOptions,
    });
    await publishedDaRelease(t, f, evf, 'CPD-000001 TPP F', {
      bytes: Buffer.from(tppWithoutChecks()),
      file: TPP,
      importer: 'tpp_tr',
      importOptions: tppOptions,
    });
    for (const [name, file] of [
      ['Compound targets F', 'compound_targets.tsv'],
      ['Protein annotations F', 'target_annotations.tsv'],
    ])
      await publishedDaRelease(t, f, evf, name!, {
        file: `../../reference/${file}`,
        importer: 'reference_target_annotation',
      });
    evfToken = f;
    // EVM: a mouse experiment: gene symbols are not matched to the (human) annotations.
    evm = await t.program('EVM');
    const m = (await t.user('evm-user', { [evm]: 'contributor' })).token;
    await publishedDaRelease(t, m, evm, 'CPD-000001 TPP mouse', {
      file: TPP,
      importer: 'tpp_tr',
      importOptions: tppOptions,
      species: { id: 'NCBITaxon:10090', label: 'Mus musculus' },
    });
    for (const [name, file] of [
      ['Compound targets M', 'compound_targets.tsv'],
      ['Protein annotations M', 'target_annotations.tsv'],
    ])
      await publishedDaRelease(t, m, evm, name!, {
        file: `../../reference/${file}`,
        importer: 'reference_target_annotation',
      });
    evmToken = m;
  }, 300_000);
  afterAll(() => t.close());

  const get = (url: string, as = token) => t.call(as, { method: 'GET', url });
  const find = (body: Json, gene: string) => body.proteins.find((p: Json) => p.gene === gene);
  const measured = (p: Json) => Number(p.lines.dose) + Number(p.lines.thermal);

  it('EVD-01: lines up dose-response, thermal shift and annotation per protein, each item saying how it was matched', async () => {
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
    expect(body.sources.dose_response[0].features).toBeGreaterThan(100); // denominators
    expect(body.sources.thermal_shift[0].features).toBe(30);
    const tp53 = find(body, 'TP53');
    expect(tp53).toMatchObject({
      accession: 'P04637',
      annotation: { role: 'primary_target', matched_by: 'accession' },
      lines: { annotation: true, thermal: true, dose: false },
    });
    // Tested in the dose-response dataset, not regulated: not the same as not measured.
    expect(tp53.dose).toMatchObject({ tested: 1, regulated: 0, best: null });
    expect(tp53.thermal).toMatchObject({
      basis: 'tpp_requirements',
      replicate_checks: 'met',
      direction: 'stabilised',
    });
    expect(tp53.thermal.rows.map((x: Json) => x.comparison).sort()).toEqual([
      'CPD5_1 vs Vehicle_1',
      'CPD5_2 vs Vehicle_2',
    ]);
    expect(tp53.thermal.rows[0]).toMatchObject({
      feature_id: 'TP53',
      matched_by: 'gene symbol via target annotations',
    });
    expect(find(body, 'KRAS')).toMatchObject({
      annotation: { role: 'off_target' },
      thermal: { direction: 'destabilised' },
      lines: { thermal: true },
    });
    const tubb = body.proteins.find((p: Json) => p.accession === 'P07437');
    expect(tubb).toMatchObject({
      lines: { dose: true },
      dose: { tested: 1, regulated: 1 },
      ambiguous_group: false,
    });
    expect(tubb.dose.best.pec50).toBeCloseTo(8.22, 1);
    expect(tubb.thermal).toBeNull(); // not in the TPP table: not measured
    expect(body.notes.join(' ')).toMatch(/no combined score/i);
  });

  it('EVD-01: ordered by measured lines, then annotation, then potency; the pEC50 threshold changes the dose line', async () => {
    const body = (await get('/v1/compounds/CPD-000001/target-evidence')).json() as Json;
    const m = body.proteins.map(measured);
    expect([...m].sort((a, b) => b - a)).toEqual(m);
    for (const p of body.proteins) expect(measured(p) + Number(p.lines.annotation)).toBeGreaterThan(0);
    const strict = (await get('/v1/compounds/CPD-000001/target-evidence?pec50_min=9')).json() as Json;
    expect(strict.proteins.find((p: Json) => p.accession === 'P07437')).toBeUndefined();
    // With TPP's replicate checks available, they decide the thermal line, not the adjusted-p threshold.
    const tight = (await get('/v1/compounds/CPD-000001/target-evidence?adj_p_max=0.0001')).json() as Json;
    expect(find(tight, 'AKT1')).toMatchObject({
      lines: { thermal: true },
      thermal: { basis: 'tpp_requirements' },
    });
    expect((await get('/v1/compounds/CPD-000001/target-evidence?pec50_min=20')).statusCode).toBe(400);
  });

  it('EVD-01: without TPP replicate checks every comparison must pass with the same sign; groups go to the annotated member', async () => {
    const body = (await get('/v1/compounds/CPD-000001/target-evidence', evfToken)).json() as Json;
    expect(body.program_id).toBe(evf);
    // KRAS stays listed (an annotated off-target) but its thermal line fails: signs differ, one p above 0.05.
    expect(find(body, 'KRAS')).toMatchObject({
      lines: { thermal: false, annotation: true },
      thermal: { basis: 'all_comparisons', replicate_checks: 'not computed', direction: 'inconsistent' },
    });
    expect(find(body, 'AKT1')).toMatchObject({
      lines: { thermal: true },
      thermal: { basis: 'all_comparisons' },
    });
    const tp53 = body.proteins.find((p: Json) => p.accession === 'P04637');
    expect(tp53).toMatchObject({ ambiguous_group: true, lines: { dose: true, annotation: true } });
    expect(tp53.dose.best.feature_id).toBe('P99999;P04637');
    expect(body.proteins.find((p: Json) => p.accession === 'P99999')).toBeUndefined();
  });

  it('EVD-01: gene symbols from a non-human experiment are not matched to the annotations', async () => {
    const body = (await get('/v1/compounds/CPD-000001/target-evidence', evmToken)).json() as Json;
    expect(body.program_id).toBe(evm);
    const akt1 = body.proteins.find((p: Json) => p.key === 'gene:AKT1');
    expect(akt1).toMatchObject({ accession: null, annotation: null });
    expect(akt1.thermal.rows[0].matched_by).toBe('gene symbol only');
    const tp53Gene = body.proteins.find((p: Json) => p.key === 'gene:TP53');
    expect(tp53Gene.annotation).toBeNull();
    expect(body.notes.join(' ')).toMatch(/Mus musculus|NCBITaxon:10090/);
  });

  it('EVD-01: only readable programs, and nothing for a compound without evidence', async () => {
    const hidden = (await get('/v1/compounds/CPD-000001/target-evidence', outsider)).json() as Json;
    expect(hidden).toMatchObject({ program_id: null, proteins: [] });
    const none = (await get('/v1/compounds/CPD-999999/target-evidence')).json() as Json;
    expect(none.proteins).toEqual([]);
  });
});
