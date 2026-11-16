// Selectivity table (Phase 43, SEL-04): how rows are classed and ordered. Pure, so the rules are unit-tested.
// S(x) is only compared within one profiling dataset: it depends on how many proteins that dataset tested.

export type RowStatus = 'ranked' | 'inactive' | 'no_score';

/** Nothing regulated at the threshold is inactive there, not selective; nothing tested has no score. */
export function rowStatus(r: { s_regulated: number; s_score: number | null }): RowStatus {
  if (r.s_score === null) return 'no_score';
  return r.s_regulated >= 1 ? 'ranked' : 'inactive';
}

const STATUS_ORDER: Record<RowStatus, number> = { ranked: 0, inactive: 1, no_score: 2 };

/** Datasets in the order given; within a dataset: ranked rows by S (lowest first), then inactive, then unscored. */
export function orderRows<
  T extends { dataset: number; compound_id: string; s_regulated: number; s_score: number | null },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.dataset - b.dataset ||
      STATUS_ORDER[rowStatus(a)] - STATUS_ORDER[rowStatus(b)] ||
      (a.s_score ?? 0) - (b.s_score ?? 0) ||
      a.compound_id.localeCompare(b.compound_id),
  );
}

/** The tool that fitted a compound's curves; several tools are named, never reduced to one. */
export function methodLabel(methods: Set<string>): string | null {
  if (methods.size === 0) return null;
  const sorted = [...methods].sort();
  return sorted.length === 1 ? sorted[0]! : `mixed: ${sorted.join(', ')}`;
}
