import { describe, expect, it } from 'vitest';
import { cnetElements } from './cnet.ts';

const term = (id: string, adj: number, genes: string[]) => ({
  id,
  name: `Set ${id}`,
  size: 20,
  overlap: genes.length,
  expected: 1,
  fold_enrichment: 2,
  p_value: adj / 2,
  adj_p_value: adj,
  genes,
});

describe('gene–concept network', () => {
  it('NET-02: the top terms and their hit genes become nodes; genes shared by terms appear once', () => {
    const { nodes, edges, shownTerms, hiddenTerms } = cnetElements(
      [term('T1', 0.001, ['A', 'B']), term('T2', 0.01, ['B', 'C']), term('T3', 0.5, ['D'])],
      [
        { id: 'A', log2_fc: 2, features: 1, direction: 'up' },
        { id: 'B', log2_fc: -1.5, features: 1, direction: 'down' },
        { id: 'C', log2_fc: null, features: 2, direction: 'mixed' },
        { id: 'D', log2_fc: 1, features: 1, direction: 'up' },
      ],
      2,
    );
    expect(shownTerms).toBe(2);
    expect(hiddenTerms).toBe(1);
    expect(nodes.filter((n) => n.data.kind === 'term').map((n) => n.data.id)).toEqual(['term:T1', 'term:T2']);
    expect(nodes.filter((n) => n.data.kind === 'gene').map((n) => n.data.label)).toEqual(['A', 'B', 'C']);
    expect(edges).toHaveLength(4);
    const c = nodes.find((n) => n.data.label === 'C')!;
    expect(c.data.log2_fc).toBeNull(); // several features: no single value is shown
    expect(c.data.direction).toBe('mixed');
  });
});
