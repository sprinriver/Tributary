// Interaction networks (Phase 45, PPI-01): parsing an interaction list and the network of a contrast's hits. Pure,
// so every rule is unit-tested. Nothing is computed beyond selection and counting (no network statistics).
//
// Scores are whole numbers from 0 to 1000, as STRING writes its combined score (probability × 1000; file format of
// protein.links at https://stringdb-downloads.org, v12.0). Interactions are undirected: a pair is stored once.

export interface Edge {
  a: string;
  b: string;
  score: number;
}

/** Reads "a<TAB>b<TAB>score" lines (a header and # comments are skipped). */
export function parseInteractions(text: string): {
  edges: Edge[];
  errors: { line: number; message: string }[];
  selfPairs: number;
  duplicates: number;
} {
  const best = new Map<string, Edge>();
  const errors: { line: number; message: string }[] = [];
  let selfPairs = 0;
  let duplicates = 0;
  let n = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    n += 1;
    const [x = '', y = '', s = ''] = line.split('\t').map((v) => v.trim());
    if (n === 1 && s.toLowerCase().includes('score')) {
      n = 0; // a header line is not counted
      continue;
    }
    if (!x || !y) {
      errors.push({ line: n, message: 'needs two identifiers and a score, separated by tabs' });
      continue;
    }
    if (!/^\d+$/.test(s) || Number(s) > 1000) {
      errors.push({ line: n, message: `the score must be a whole number from 0 to 1000, got "${s}"` });
      continue;
    }
    if (x === y) {
      selfPairs += 1;
      continue;
    }
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}\u0000${b}`;
    const seen = best.get(key);
    if (seen) duplicates += 1;
    if (!seen || Number(s) > seen.score) best.set(key, { a: a!, b: b!, score: Number(s) });
  }
  const edges = [...best.values()].sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
  return { edges, errors, selfPairs, duplicates };
}

export interface HitGene {
  log2_fc: number | null;
  features: number;
  direction: 'up' | 'down' | 'mixed';
}

/**
 * The network of hits: `edges` are the collection's edges between two hits at the score asked for. The strongest
 * `maxEdges` are shown; nodes are their ends. Hits without a partner, or absent from the collection, are counted.
 */
export function hitNetwork(
  hits: Map<string, HitGene>,
  edges: Edge[],
  options: { inCollection: Set<string>; maxEdges: number },
) {
  const sorted = [...edges].sort(
    (p, q) => q.score - p.score || p.a.localeCompare(q.a) || p.b.localeCompare(q.b),
  );
  const shown = sorted.slice(0, options.maxEdges);
  const connected = new Set(edges.flatMap((e) => [e.a, e.b]));
  const degree = new Map<string, number>();
  for (const e of shown) for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const nodes = [...degree.keys()].sort().map((id) => ({ id, degree: degree.get(id)!, ...hits.get(id)! }));
  const inCollection = [...hits.keys()].filter((id) => options.inCollection.has(id)).length;
  return {
    nodes,
    edges: shown,
    counts: {
      hits: hits.size,
      hits_in_collection: inCollection,
      hits_not_in_collection: hits.size - inCollection,
      edges: edges.length,
      edges_shown: shown.length,
      hits_connected: connected.size,
      hits_without_partner: inCollection - connected.size,
    },
  };
}
