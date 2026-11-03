import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { ONC_DIA_05, publishedPqRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 27: cross-experiment QC and batch effects. The statistics (medians, PCA) come from apps/compute; here the
// API's part: which runs are read, how IDs and missingness are counted, which runs are flagged and what the PCA gets.

const MATRIX = readFileSync(`${ONC_DIA_05}/report.pg_matrix.tsv`, 'utf8').trim().split('\n');
const RUN_COLS = MATRIX[0]!.split('\t').slice(4).length;
const PROTEINS = MATRIX.length - 1;
/** Protein groups with a value > 0 in each run column of the fixture. */
const idsPerRun = (lines: string[]) =>
  Array.from(
    { length: RUN_COLS },
    (_, i) => lines.slice(1).filter((l) => Number(l.split('\t')[4 + i] || 0) > 0).length,
  );
/** The fixture with run 6 left empty except for its first `keep` protein groups (a failed injection). */
const withPoorRun6 = (keep: number) =>
  Buffer.from(
    MATRIX.map((l, row) => {
      if (row === 0 || row <= keep) return l;
      const v = l.split('\t');
      v[4 + RUN_COLS - 1] = '';
      return v.join('\t');
    }).join('\n') + '\n',
  );

/** Medians and a PCA answer; records what the API sent. */
function computeStub() {
  const calls: { path: string; body: Json }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/stats/group-summary')
      return Response.json({
        groups: (body.groups as { name: string; values: number[] }[]).map((g) => {
          const s = [...g.values].sort((a, b) => a - b);
          const m = s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : null;
          return { name: g.name, n: s.length, mean: m, sd: null, sem: null, ci95: null, median: m, cv: null };
        }),
        compute_version: 'tributary-compute 0.0.0',
      });
    if (url.pathname === '/stats/pca') {
      const rows = body.values as number[][];
      return Response.json({
        scores: rows.map((_, i) => [i, -i]),
        loadings: rows[0]!.map(() => [0.1, 0.2]),
        explained_variance_ratio: [0.6, 0.2],
        compute_version: 'tributary-compute 0.0.0',
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('cross-experiment QC', () => {
  let t: TestApi;
  let program: string;
  let scientist: string;
  let outsider: string;
  let early: string;
  let late: string;
  const stub = computeStub();
  const overview = (token: string, payload: Json = {}) =>
    t.call(token, { method: 'POST', url: '/v1/qc/overview', payload });

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true, fetch: stub.fetchImpl });
    program = await t.program('QCD');
    const other = await t.program('QCX');
    scientist = (await t.user('qcd-scientist', { [program]: 'contributor' })).token;
    outsider = (await t.user('qcd-outsider', { [other]: 'contributor' })).token;
    ({ release: early } = await publishedPqRelease(t, scientist, program, 'QC early', {
      experimentDate: '2026-01-10',
    }));
    ({ release: late } = await publishedPqRelease(t, scientist, program, 'QC late', {
      experimentDate: '2026-03-10',
      bytes: withPoorRun6(10),
    }));
  }, 300_000);
  afterAll(() => t.close());

  it('QCD-01: per-run IDs, missingness and medians for each readable experiment, oldest first', async () => {
    const res = await overview(scientist);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.provenance.release_ids.sort()).toEqual([early, late].sort());
    expect(body.experiments.map((e: Json) => e.experiment_name)).toEqual(['QC early', 'QC late']);
    expect(body.runs).toHaveLength(2 * RUN_COLS);
    expect(body.runs.slice(0, RUN_COLS).every((r: Json) => r.experiment_name === 'QC early')).toBe(true);

    const expectedEarly = idsPerRun(MATRIX);
    const earlyRuns = body.runs.filter((r: Json) => r.release_id === early);
    expect(earlyRuns.map((r: Json) => r.ids)).toEqual(expectedEarly);
    expect(earlyRuns[0].sample_key).toBe('ONC-DIA-05-S01');
    expect(earlyRuns[0].missing_pct).toBeCloseTo((100 * (PROTEINS - expectedEarly[0]!)) / PROTEINS, 9);
    expect(earlyRuns[0].factors).toMatchObject({ plate: 'ONC-DIA-05-P1', condition: 'DMSO' });
    expect(typeof earlyRuns[0].median_log2_intensity).toBe('number');
    expect(earlyRuns[0].program_code).toBe('QCD');

    // The medians are computed by apps/compute from log2 intensities of quantified protein groups only.
    const summary = stub.calls.find((c) => c.path === '/stats/group-summary')!;
    const first = (summary.body.groups as { name: string; values: number[] }[])[0]!;
    expect(first.values).toHaveLength(expectedEarly[0]!);
    expect(first.values.every((v) => Number.isFinite(v) && v > 5)).toBe(true); // log2 scale, not linear

    expect(body.figures.trend.data.length).toBeGreaterThan(0);
    expect(body.provenance.transformations.join(' ')).toMatch(/not quantified/);
    expect(body.provenance.transformations.join(' ')).toMatch(/no normalisation/i);
  });

  it('QCD-02: a run far below its experiment’s median IDs is flagged and left out of the PCA', async () => {
    const body = (await overview(scientist, { color_by: 'plate' })).json() as Json;
    const lateRuns = body.runs.filter((r: Json) => r.release_id === late);
    expect(lateRuns.at(-1)).toMatchObject({ ids: 10, flagged: true });
    expect(lateRuns.slice(0, -1).every((r: Json) => !r.flagged)).toBe(true);
    expect(body.runs.filter((r: Json) => r.release_id === early).some((r: Json) => r.flagged)).toBe(false);
    expect(body.experiments.find((e: Json) => e.experiment_name === 'QC late').flagged_runs).toBe(1);

    // PCA over the 11 unflagged runs × protein groups quantified in all of them.
    const pca = stub.calls.filter((c) => c.path === '/stats/pca').at(-1)!;
    const matrix = pca.body.values as number[][];
    expect(matrix).toHaveLength(2 * RUN_COLS - 1);
    expect(body.provenance.pca_features).toBe(matrix[0]!.length);
    expect(matrix[0]!.length).toBeGreaterThan(100);
    expect(body.provenance).toMatchObject({ color_by: 'plate', pca_explained: [0.6, 0.2] });
    expect(body.provenance.pca_note).toMatch(/1 flagged run/);
    expect(JSON.stringify(body.figures.pca.layout)).toMatch(/PC1 \(60\.0%\)/);
  });

  it('QCD-02: programs the caller cannot read are invisible; too few runs means no PCA, with a reason', async () => {
    const theirs = (await overview(outsider)).json() as Json;
    expect(theirs).toMatchObject({ runs: [], experiments: [] });
    expect(theirs.figures.pca).toBeNull();
    expect(theirs.provenance.pca_note).toMatch(/at least 3 runs/);
    expect((await overview(outsider, { program_id: program })).statusCode).toBe(403);
    const one = (await overview(scientist, { max_experiments: 1 })).json() as Json;
    expect(one.experiments.map((e: Json) => e.experiment_name)).toEqual(['QC late']); // newest
  });
});
