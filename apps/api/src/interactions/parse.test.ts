import { describe, expect, it } from 'vitest';
import { hitNetwork, parseInteractions } from './network.ts';

describe('interaction networks', () => {
  it('PPI-01: reads "a<TAB>b<TAB>score" lines; a pair is kept once (highest score), self-pairs are dropped', () => {
    const text = [
      '# comment',
      'a\tb\tscore',
      'TP53\tMDM2\t999',
      'MDM2\tTP53\t950',
      'AKT1\tAKT1\t800',
      'AKT1\tPARP1\t700',
      '',
    ].join('\n');
    const { edges, errors, selfPairs, duplicates } = parseInteractions(text);
    expect(errors).toEqual([]);
    expect(edges).toEqual([
      { a: 'AKT1', b: 'PARP1', score: 700 },
      { a: 'MDM2', b: 'TP53', score: 999 },
    ]);
    expect([selfPairs, duplicates]).toEqual([1, 1]);
  });

  it('PPI-01: scores must be whole numbers from 0 to 1000 (STRING’s combined score × 1000); bad lines are reported', () => {
    const { edges, errors } = parseInteractions('A\tB\t0.9\nA\tC\nA\tD\t1200\nA\tE\t400');
    expect(edges).toEqual([{ a: 'A', b: 'E', score: 400 }]);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });

  it('PPI-01: the network of hits keeps edges between two hits, strongest first, and counts what is left out', () => {
    const hits = new Map([
      ['AKT1', { log2_fc: 2.2, features: 1, direction: 'up' as const }],
      ['PARP1', { log2_fc: -1.6, features: 1, direction: 'down' as const }],
      ['S53', { log2_fc: null, features: 2, direction: 'mixed' as const }],
      ['LONELY', { log2_fc: 1.1, features: 1, direction: 'up' as const }],
      ['ABSENT', { log2_fc: 1.3, features: 1, direction: 'up' as const }],
    ]);
    const net = hitNetwork(
      hits,
      [
        { a: 'AKT1', b: 'S53', score: 650 },
        { a: 'AKT1', b: 'PARP1', score: 900 },
      ],
      { inCollection: new Set(['AKT1', 'PARP1', 'S53', 'LONELY']), maxEdges: 1 },
    );
    expect(net.edges).toEqual([{ a: 'AKT1', b: 'PARP1', score: 900 }]);
    expect(net.nodes.map((n) => [n.id, n.degree])).toEqual([
      ['AKT1', 1],
      ['PARP1', 1],
    ]);
    expect(net.counts).toEqual({
      hits: 5,
      hits_in_collection: 4,
      hits_not_in_collection: 1,
      edges: 2,
      edges_shown: 1,
      hits_connected: 3,
      hits_without_partner: 1,
    });
  });
});
