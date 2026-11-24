import { describe, expect, it } from 'vitest';
import { selectIds, type DaRow } from './select.ts';

const row = (genes: string[], log2_fc: number, adj_p_value = 0.001): DaRow => ({
  contrast_label: 'A vs B',
  gene_names: genes,
  protein_ids: [],
  log2_fc,
  adj_p_value,
  adj_method: 'BH',
});
const rule = { direction: 'both' as const, adj_p_max: 0.05, abs_log2fc_min: 1 };

describe('hit identifiers for the gene–concept network', () => {
  it('NET-01: a hit in one feature keeps its log2 FC; several features report a count and agreement, never a pick', () => {
    const sel = selectIds(
      [
        row(['ONE'], 2.5),
        row(['TWO'], 1.5),
        row(['TWO'], 3), // same sign: agree, but no single value
        row(['MIX'], 2),
        row(['MIX'], -2), // opposite signs
        row(['NOT'], 0.2), // not a hit
      ],
      'gene_symbol',
      rule,
    );
    expect(sel.hitGenes.get('ONE')).toEqual({ log2_fc: 2.5, features: 1, direction: 'up' });
    expect(sel.hitGenes.get('TWO')).toEqual({ log2_fc: null, features: 2, direction: 'up' });
    expect(sel.hitGenes.get('MIX')).toEqual({ log2_fc: null, features: 2, direction: 'mixed' });
    expect(sel.hitGenes.has('NOT')).toBe(false);
  });
});
