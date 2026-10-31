// Dendrogram drawing from a SciPy linkage matrix: leaves at positions 0…n−1 in leaf order, merges at their height.

export interface Tree {
  order: number[];
  linkage: number[][];
  support: number[] | null;
}

export interface Link {
  /** Positions along the leaf axis and heights, as polyline points. */
  pos: number[];
  height: number[];
  /** Merge index (row of the linkage matrix). */
  k: number;
  h: number;
}

export function links(
  tree: Tree,
  interpolation: 'step' | 'linear',
): { links: Link[]; nodes: { pos: number; h: number; k: number }[] } {
  const n = tree.order.length;
  const pos = new Map<number, number>(tree.order.map((leaf, i) => [leaf, i]));
  const height = new Map<number, number>(tree.order.map((leaf) => [leaf, 0]));
  const out: Link[] = [];
  const nodes: { pos: number; h: number; k: number }[] = [];
  tree.linkage.forEach(([a, b, h], k) => {
    const pa = pos.get(a!)!;
    const pb = pos.get(b!)!;
    const ha = height.get(a!)!;
    const hb = height.get(b!)!;
    const mid = (pa + pb) / 2;
    out.push(
      interpolation === 'step'
        ? { pos: [pa, pa, pb, pb], height: [ha, h!, h!, hb], k, h: h! }
        : { pos: [pa, mid, pb], height: [ha, h!, hb], k, h: h! },
    );
    nodes.push({ pos: mid, h: h!, k });
    pos.set(n + k, mid);
    height.set(n + k, h!);
  });
  return { links: out, nodes };
}

/** Cluster colouring: each maximal subtree whose merges sit below `threshold` gets one colour; links above are grey. */
export function clusterOf(tree: Tree, threshold: number): (number | null)[] {
  const n = tree.order.length;
  const cluster: (number | null)[] = tree.linkage.map(() => null);
  let next = 0;
  for (let k = tree.linkage.length - 1; k >= 0; k--) {
    if (tree.linkage[k]![2]! >= threshold) continue;
    const parent = tree.linkage.findIndex(([a, b]) => a === n + k || b === n + k);
    cluster[k] = parent >= 0 && cluster[parent] !== null ? cluster[parent]! : next++;
  }
  return cluster;
}
