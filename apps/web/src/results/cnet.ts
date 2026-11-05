// Gene–concept network elements (Phase 30, NET-02): a display transform of an enrichment result. The statistics and
// the hit values come from the API; nothing is computed here.
import type { EnrichmentHitGene, EnrichmentTerm } from '@tributary/contracts';

export const NETWORK_TERMS = 8;

export interface NetNode {
  data: {
    id: string;
    label: string;
    kind: 'term' | 'gene';
    /** Terms: hits in the set; genes: sets they are in. */
    degree: number;
    adj_p_value?: number;
    log2_fc?: number | null;
    direction?: EnrichmentHitGene['direction'];
    features?: number;
  };
}
export interface NetEdge {
  data: { id: string; source: string; target: string };
}

/** The top `topN` terms (by the API's order: most significant first) and the hit genes in them. */
export function cnetElements(terms: EnrichmentTerm[], hitGenes: EnrichmentHitGene[], topN = NETWORK_TERMS) {
  const shown = terms.slice(0, topN);
  const byId = new Map(hitGenes.map((g) => [g.id, g]));
  const genes = new Map<string, number>();
  const edges: NetEdge[] = [];
  for (const t of shown)
    for (const g of t.genes) {
      genes.set(g, (genes.get(g) ?? 0) + 1);
      edges.push({ data: { id: `${t.id}|${g}`, source: `term:${t.id}`, target: `gene:${g}` } });
    }
  const nodes: NetNode[] = [
    ...shown.map((t) => ({
      data: {
        id: `term:${t.id}`,
        label: t.name.length > 40 ? `${t.name.slice(0, 37)}…` : t.name,
        kind: 'term' as const,
        degree: t.genes.length,
        adj_p_value: t.adj_p_value,
      },
    })),
    ...[...genes.keys()].sort().map((g) => {
      const hit = byId.get(g);
      return {
        data: {
          id: `gene:${g}`,
          label: g,
          kind: 'gene' as const,
          degree: genes.get(g)!,
          log2_fc: hit ? hit.log2_fc : null,
          direction: hit?.direction ?? 'mixed',
          features: hit?.features ?? 0,
        },
      };
    }),
  ];
  return { nodes, edges, shownTerms: shown.length, hiddenTerms: terms.length - shown.length };
}
