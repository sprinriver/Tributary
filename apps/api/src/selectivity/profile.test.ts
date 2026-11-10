import { describe, expect, it } from 'vitest';
import { selectivityProfile, type CurveRow, type Known } from './profile.ts';

const DOSES = [0, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5]; // 1 nM … 10 µM: pEC50 5–9 is inside the tested range
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
  doses_molar: DOSES,
  ...extra,
});

const rows: CurveRow[] = [
  row('P1', 'down', 7.5), // primary target
  row('P2', 'down', 6.2),
  row('P3', 'up', 5.0),
  row('P4', 'down', null), // regulated, no pEC50
  row('P5', 'not', null),
  row('P6', 'unclear', null), // the tool gave no class: not tested
  row('Q9-2', 'down', 6.0, { protein_ids: ['Q9-2'] }), // isoform of an annotated off-target
];
const known: Known = {
  accessions: new Map([
    ['P1', 'primary_target'],
    ['Q9', 'off_target'],
  ]),
  genes: new Map(),
};
const both = { pec50Min: 6, direction: 'both' as const };

describe('compound selectivity profile', () => {
  it('SEL-01: tested proteins are those the tool classed (up, down or not); unclassified curves are counted apart', () => {
    const p = selectivityProfile(rows, known, both);
    expect(p.tested).toBe(6);
    expect(p.unclassified).toBe(1);
    expect(p.regulated).toBe(5);
    expect(p.regulated_up).toBe(1);
    expect(p.regulated_down).toBe(4);
    expect(p.regulated_without_pec50).toBe(1);
    // pEC50 ≥ 6 (EC50 ≤ 1 µM): P1, P2, Q9-2 → 3 of 6 tested.
    expect(p.s_score).toEqual({
      pec50_min: 6,
      ec50_max_molar: 1e-6,
      direction: 'both',
      regulated: 3,
      tested: 6,
      score: 0.5,
    });
  });

  it('SEL-01: a direction can be chosen (e.g. down for competition binding): the other direction counts for neither S nor the window', () => {
    const upFirst = [...rows, row('P7', 'up', 7.2)];
    const down = selectivityProfile(upFirst, known, { pec50Min: 6, direction: 'down' });
    expect(down.s_score.regulated).toBe(3);
    expect(down.proteins.map((x) => x.feature_id)).not.toContain('P7');
    expect(down.window.next).toEqual({ feature_id: 'P2', pec50: 6.2 });
    const all = selectivityProfile(upFirst, known, both);
    expect(all.window.next).toEqual({ feature_id: 'P7', pec50: 7.2 });
  });

  it('SEL-01: regulated proteins ranked by pEC50 (most potent first, without pEC50 last), with known-target labels', () => {
    const p = selectivityProfile(rows, known, both);
    expect(p.proteins.map((x) => [x.feature_id, x.known])).toEqual([
      ['P1', 'primary_target'],
      ['P2', null],
      ['Q9-2', 'off_target'], // isoform suffix ignored when matching annotations
      ['P3', null],
      ['P4', null],
    ]);
  });

  it('SEL-01: the selectivity window is the primary target’s pEC50 minus the most potent other regulated protein', () => {
    const p = selectivityProfile(rows, known, both);
    expect(p.window).toEqual({
      primary: { feature_id: 'P1', pec50: 7.5 },
      next: { feature_id: 'P2', pec50: 6.2 },
      delta: 1.3,
      note: null,
    });
  });

  it('SEL-01: no window without a regulated primary target, or without another regulated protein, and it says why', () => {
    const at = (rs: CurveRow[], k: Known = known) => selectivityProfile(rs, k, both).window;
    const notRegulated = at(rows.map((r) => (r.feature_id === 'P1' ? { ...r, regulation: 'not' } : r)));
    expect(notRegulated).toMatchObject({
      delta: null,
      note: 'No annotated primary target is regulated in this experiment.',
    });
    const noPotency = at(rows.map((r) => (r.feature_id === 'P1' ? { ...r, pec50: null } : r)));
    expect(noPotency).toMatchObject({
      delta: null,
      note: 'The annotated primary target is regulated but has no pEC50.',
    });
    expect(at([row('P1', 'down', 7), row('P5', 'not', null)])).toMatchObject({
      delta: null,
      note: 'No other protein is regulated: the window is not bounded.',
    });
    expect(at([row('P1', 'down', 7), row('P2', 'down', null)])).toMatchObject({
      delta: null,
      note: 'The other regulated proteins have no pEC50: the window is not bounded.',
    });
    expect(at(rows, { accessions: new Map(), genes: new Map() })).toMatchObject({
      delta: null,
      note: 'No primary target is annotated for this compound.',
    });
  });

  it('SEL-01: gene-level features (no protein IDs) match annotations by gene symbol, case-insensitively', () => {
    const genes: Known = { accessions: new Map(), genes: new Map([['TP53', 'primary_target']]) };
    const p = selectivityProfile(
      [row('Tp53', 'down', 7, { protein_ids: [] }), row('MDM2', 'down', 6, { protein_ids: [] })],
      genes,
      both,
    );
    expect(p.proteins[0]).toMatchObject({ feature_id: 'Tp53', known: 'primary_target' });
    expect(p.window.delta).toBe(1);
  });

  it('SEL-01: protein groups with several accessions are flagged as ambiguous', () => {
    const p = selectivityProfile([row('P1;P9', 'down', 7, { protein_ids: ['P1', 'P9'] })], known, both);
    expect(p.proteins[0]).toMatchObject({ known: 'primary_target', ambiguous: true });
  });

  it('SEL-01: a feature with several curves counts once (its most potent regulated curve) and is reported', () => {
    const p = selectivityProfile(
      [row('P1', 'down', 6.5), row('P1', 'down', 7.1), row('P2', 'not', null)],
      { accessions: new Map(), genes: new Map() },
      { pec50Min: 7, direction: 'both' },
    );
    expect(p.tested).toBe(2);
    expect(p.regulated).toBe(1);
    expect(p.duplicates).toBe(1);
    expect(p.proteins[0]!.pec50).toBe(7.1);
    expect(p.notes.join(' ')).toContain('1 protein(s) have more than one curve');
  });

  it('SEL-01: thresholds and potencies outside the tested dose range are flagged', () => {
    const p = selectivityProfile([...rows, row('P8', 'down', 9.6)], known, {
      pec50Min: 11,
      direction: 'both',
    });
    expect(p.dose_range).toEqual({ pec50_low: 5, pec50_high: 9 });
    expect(p.notes.join(' ')).toContain('outside the tested dose range');
    expect(p.proteins.find((x) => x.feature_id === 'P8')!.outside_dose_range).toBe(true);
    expect(p.proteins.find((x) => x.feature_id === 'P1')!.outside_dose_range).toBe(false);
  });
});
