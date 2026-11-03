// Hits and background for over-representation analysis (Phase 24, ENR-03): pure, so every rule is unit-testable.
// The universe is the set of identifiers the source tool tested; nothing untested or unmeasured enters it.
import type { EnrichmentBody } from '@tributary/contracts';
import { normaliseId, type IdType } from './ids.ts';

export type DaRow = {
  contrast_label: string | null;
  gene_names: unknown;
  protein_ids: unknown;
  log2_fc: number | null;
  adj_p_value: number | null;
  adj_method: string | null;
};

export interface Selection {
  background: Set<string>;
  hits: Set<string>;
  features: number;
  hitFeatures: number;
  withoutIds: number;
  untested: number;
  multiIdHitFeatures: number;
  conflictingIds: number;
  adjMethods: string[];
}

const idsOf = (v: unknown, type: IdType): string[] =>
  Array.isArray(v)
    ? [
        ...new Set(
          v
            .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
            .map((x) => normaliseId(x, type)),
        ),
      ]
    : [];

/** log2 fold change = log2(numerator / denominator): "up" is a strictly positive change of at least the threshold. */
export function isHit(
  r: DaRow,
  body: Pick<EnrichmentBody, 'direction' | 'adj_p_max' | 'abs_log2fc_min'>,
): boolean {
  if (r.adj_p_value === null || r.log2_fc === null || r.adj_p_value > body.adj_p_max) return false;
  const fc = r.log2_fc;
  if (body.direction === 'up') return fc > 0 && fc >= body.abs_log2fc_min;
  if (body.direction === 'down') return fc < 0 && -fc >= body.abs_log2fc_min;
  return fc !== 0 && Math.abs(fc) >= body.abs_log2fc_min;
}

export function selectIds(
  rows: DaRow[],
  type: IdType,
  body: Pick<EnrichmentBody, 'direction' | 'adj_p_max' | 'abs_log2fc_min'>,
): Selection {
  const column = type === 'gene_symbol' ? 'gene_names' : 'protein_ids';
  const background = new Set<string>();
  const hits = new Set<string>();
  const nonHits = new Set<string>();
  const adjMethods = new Set<string>();
  let withoutIds = 0;
  let untested = 0;
  let hitFeatures = 0;
  let multiIdHitFeatures = 0;
  for (const r of rows) {
    const ids = idsOf(r[column], type);
    if (ids.length === 0) {
      withoutIds += 1;
      continue;
    }
    // Not tested by the source tool (e.g. filtered out): it could never be a hit, so it is not in the universe.
    if (r.adj_p_value === null || r.log2_fc === null) {
      untested += 1;
      continue;
    }
    if (r.adj_method) adjMethods.add(r.adj_method);
    ids.forEach((id) => background.add(id));
    if (isHit(r, body)) {
      hitFeatures += 1;
      if (ids.length > 1) multiIdHitFeatures += 1;
      ids.forEach((id) => hits.add(id));
    } else ids.forEach((id) => nonHits.add(id));
  }
  return {
    background,
    hits,
    features: rows.length,
    hitFeatures,
    withoutIds,
    untested,
    multiIdHitFeatures,
    conflictingIds: [...hits].filter((id) => nonHits.has(id)).length,
    adjMethods: [...adjMethods].sort(),
  };
}
