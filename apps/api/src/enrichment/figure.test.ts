import { describe, expect, it } from 'vitest';
import { enrichmentFigure, TERM_FDR } from './figure.ts';

const term = (id: string, adj: number) => ({
  id,
  name: id,
  size: 10,
  overlap: 3,
  expected: 1,
  fold_enrichment: 3,
  p_value: adj / 2,
  adj_p_value: adj,
  genes: ['A'],
});

describe('enrichment dot plot', () => {
  it('ENR-04: the dashed line marks the term FDR, not the hit threshold, and is labelled', () => {
    const fig = enrichmentFigure([term('A', 0.001)], 0.2);
    const shape = (fig.layout.shapes as { x0: number }[])[0]!;
    expect(shape.x0).toBeCloseTo(-Math.log10(TERM_FDR), 12);
    expect(JSON.stringify(fig.layout.annotations)).toContain(`term FDR ${TERM_FDR}`);
  });

  it('ENR-04: every plotted x is finite', () => {
    const fig = enrichmentFigure([term('A', Number.MIN_VALUE), term('B', 1)], 0.05);
    expect((fig.data[0]!.x as number[]).every(Number.isFinite)).toBe(true);
  });
});
