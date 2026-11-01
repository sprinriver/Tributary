export interface Fused {
  id: string;
  score: number;
  ranks: { fulltext: number | null; vector: number | null };
}

/**
 * Reciprocal rank fusion: score(d) = Σ 1 / (k + rank_i(d)) over the ranked lists that contain d.
 * Cormack, Clarke & Büttcher (2009), SIGIR, doi:10.1145/1571941.1572114; k = 60 as in the paper.
 * Ties keep full-text order, then vector order.
 */
export function reciprocalRankFusion(lists: { fulltext: string[]; vector: string[] }, k = 60): Fused[] {
  const byId = new Map<string, Fused & { order: number }>();
  let order = 0;
  for (const side of ['fulltext', 'vector'] as const) {
    lists[side].forEach((id, i) => {
      const entry = byId.get(id) ?? { id, score: 0, ranks: { fulltext: null, vector: null }, order: order++ };
      entry.ranks[side] = i + 1;
      entry.score += 1 / (k + i + 1);
      byId.set(id, entry);
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ id, score, ranks }) => ({ id, score, ranks }));
}
