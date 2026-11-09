import { describe, expect, it } from 'vitest';
import { selectivityProfile, type CurveRow } from './profile.ts';

const row = (
  feature_id: string,
  regulation: string,
  pec50: number | null,
  extra: Partial<CurveRow> = {},
): CurveRow => ({
  feature_id,
  protein_ids: [feature_id],
  gene_names: [`G_${feature_id}`],
  pec50,
  regulation,
  fdr: null,
  ...extra,
});

const rows: CurveRow[] = [
  row('P1', 'down', 7.5), // primary target
  row('P2', 'down', 6.2),
  row('P3', 'up', 5.0),
  row('P4', 'down', null), // engaged, no pEC50
  row('P5', 'not', null),
  row('P6', 'unclear', null),
  row('Q9-2', 'down', 6.0, { protein_ids: ['Q9-2'] }), // isoform of an annotated off-target
];
const known = new Map([
  ['P1', 'primary_target' as const],
  ['Q9', 'off_target' as const],
]);

describe('compound selectivity profile', () => {
  it('SEL-01: counts proteins tested and engaged (the tool’s up/down calls) and the S(x) score at the chosen pEC50', () => {
    const p = selectivityProfile(rows, known, 6);
    expect(p.tested).toBe(7);
    expect(p.engaged).toBe(5);
    expect(p.engaged_without_pec50).toBe(1);
    // pEC50 ≥ 6 (EC50 ≤ 1 µM): P1, P2, Q9-2 → 3 of 7 tested.
    expect(p.s_score).toEqual({ pec50_min: 6, ec50_max_molar: 1e-6, engaged: 3, tested: 7, score: 3 / 7 });
  });

  it('SEL-01: engaged proteins ranked by pEC50 (most potent first, without pEC50 last), with known-target labels', () => {
    const p = selectivityProfile(rows, known, 6);
    expect(p.proteins.map((x) => [x.feature_id, x.known])).toEqual([
      ['P1', 'primary_target'],
      ['P2', null],
      ['Q9-2', 'off_target'], // isoform suffix ignored when matching annotations
      ['P3', null],
      ['P4', null],
    ]);
  });

  it('SEL-01: the selectivity window is the primary target’s pEC50 minus the most potent other engaged protein', () => {
    const p = selectivityProfile(rows, known, 6);
    expect(p.window).toEqual({
      primary: { feature_id: 'P1', pec50: 7.5 },
      next: { feature_id: 'P2', pec50: 6.2 },
      delta: 1.3,
      note: null,
    });
  });

  it('SEL-01: no window without an engaged primary target, or without another engaged protein, and it says why', () => {
    const notEngaged = selectivityProfile(
      rows.map((r) => (r.feature_id === 'P1' ? { ...r, regulation: 'not' } : r)),
      known,
      6,
    );
    expect(notEngaged.window).toMatchObject({
      delta: null,
      note: 'No annotated primary target is engaged in this experiment.',
    });
    const alone = selectivityProfile([row('P1', 'down', 7), row('P5', 'not', null)], known, 6);
    expect(alone.window).toMatchObject({
      delta: null,
      note: 'No other protein is engaged: the window is not bounded.',
    });
    const unannotated = selectivityProfile(rows, new Map(), 6);
    expect(unannotated.window).toMatchObject({
      delta: null,
      note: 'No primary target is annotated for this compound.',
    });
  });

  it('SEL-01: a feature appearing twice (e.g. two curves) counts once, using its most potent regulated curve', () => {
    const p = selectivityProfile(
      [row('P1', 'down', 6.5), row('P1', 'down', 7.1), row('P2', 'not', null)],
      new Map(),
      7,
    );
    expect(p.tested).toBe(2);
    expect(p.engaged).toBe(1);
    expect(p.proteins[0]!.pec50).toBe(7.1);
    expect(p.s_score.engaged).toBe(1);
  });
});
