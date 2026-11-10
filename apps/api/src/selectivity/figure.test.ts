import { describe, expect, it } from 'vitest';
import { selectivityFigure } from './figure.ts';
import { selectivityProfile, type CurveRow } from './profile.ts';

const row = (i: number, regulation: string): CurveRow => ({
  feature_id: `P${i}`,
  protein_ids: [`P${i}`],
  gene_names: [],
  pec50: 5 + i / 20,
  regulation,
  fdr: null,
  doses_molar: [0, 1e-9, 1e-5],
});

describe('selectivity figure', () => {
  it('SEL-02: the threshold line is labelled, symbols are explained, and truncation is stated', () => {
    const rows = Array.from({ length: 45 }, (_, i) => row(i, i % 2 ? 'up' : 'down'));
    const fig = selectivityFigure(
      selectivityProfile(
        rows,
        { accessions: new Map(), genes: new Map() },
        { pec50Min: 6, direction: 'both' },
      ),
    );
    const text = JSON.stringify(fig.layout);
    expect(text).toContain('S threshold: pEC50 6 (EC50 1 µM)');
    expect(text).toContain('40 most potent of 45 regulated proteins with a pEC50');
    expect(fig.data.map((t) => t.name)).toEqual(expect.arrayContaining(['Other · down', 'Other · up']));
  });
});
