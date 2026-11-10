// Compound selectivity profile (Phase 42, SEL-01): pure counting and selection over one profiling experiment's
// dose-response curves, so every rule is unit-tested. No statistics are computed here.
//
// S(x) after Karaman et al. 2008 (Nat Biotechnol 26:127, doi:10.1038/nbt1358): the fraction of tested proteins
// engaged at potency x or better. They used Kd (S(3 µM)); here the potency is the source tool's pEC50, an apparent
// cellular potency (pEC50 = −log10(EC50 in M)), and "engaged" is the tool's own regulation call (up or down).

export type KnownRole = 'primary_target' | 'off_target';

export interface CurveRow {
  feature_id: string;
  protein_ids: unknown;
  gene_names: unknown;
  pec50: number | null;
  /** up, down, not or unclear (the importers' classes). */
  regulation: string;
  fdr: number | null;
}

export interface EngagedProtein {
  feature_id: string;
  genes: string;
  pec50: number | null;
  regulation: string;
  fdr: number | null;
  known: KnownRole | null;
}

export interface SelectivityProfile {
  tested: number;
  engaged: number;
  engaged_without_pec50: number;
  s_score: {
    pec50_min: number;
    ec50_max_molar: number;
    engaged: number;
    tested: number;
    score: number | null;
  };
  window: {
    primary: { feature_id: string; pec50: number } | null;
    next: { feature_id: string; pec50: number } | null;
    /** primary pEC50 − next pEC50 (log units): > 0 means the primary target is engaged more potently. */
    delta: number | null;
    note: string | null;
  };
  /** Engaged proteins, most potent first; those without a pEC50 last. */
  proteins: EngagedProtein[];
}

const ENGAGED = new Set(['up', 'down']);
/** UniProt accessions without an isoform suffix ("P12345-2" → "P12345"). */
const base = (id: string) => id.trim().replace(/-\d+$/, '');
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
/** Rounds away binary noise in a difference of two pEC50 values (inputs carry far fewer decimals). */
const round = (x: number) => Math.round(x * 1e9) / 1e9;

function knownRole(r: CurveRow, known: Map<string, KnownRole>): KnownRole | null {
  const ids = [r.feature_id, ...list(r.protein_ids)].map(base);
  if (ids.some((id) => known.get(id) === 'primary_target')) return 'primary_target';
  if (ids.some((id) => known.get(id) === 'off_target')) return 'off_target';
  return null;
}

const morePotent = (a: number | null, b: number | null) => (a ?? -Infinity) > (b ?? -Infinity);

export function selectivityProfile(
  rows: CurveRow[],
  known: Map<string, KnownRole>,
  pec50Min: number,
): SelectivityProfile {
  // One entry per feature: an engaged curve wins over others; among engaged curves, the most potent.
  const byFeature = new Map<string, CurveRow>();
  for (const r of rows) {
    const seen = byFeature.get(r.feature_id);
    const engaged = ENGAGED.has(r.regulation);
    if (
      !seen ||
      (engaged && !ENGAGED.has(seen.regulation)) ||
      (engaged && ENGAGED.has(seen.regulation) && morePotent(r.pec50, seen.pec50))
    )
      byFeature.set(r.feature_id, r);
  }
  const tested = byFeature.size;
  const proteins: EngagedProtein[] = [...byFeature.values()]
    .filter((r) => ENGAGED.has(r.regulation))
    .map((r) => ({
      feature_id: r.feature_id,
      genes: list(r.gene_names).join('; '),
      pec50: r.pec50,
      regulation: r.regulation,
      fdr: r.fdr,
      known: knownRole(r, known),
    }))
    .sort(
      (a, b) => (b.pec50 ?? -Infinity) - (a.pec50 ?? -Infinity) || a.feature_id.localeCompare(b.feature_id),
    );
  const sEngaged = proteins.filter((p) => p.pec50 !== null && p.pec50 >= pec50Min).length;

  const withPotency = proteins.filter((p): p is EngagedProtein & { pec50: number } => p.pec50 !== null);
  const primary = withPotency.find((p) => p.known === 'primary_target') ?? null;
  const next = withPotency.find((p) => p.known !== 'primary_target') ?? null;
  const anyPrimary = [...known.values()].includes('primary_target');
  const note = !anyPrimary
    ? 'No primary target is annotated for this compound.'
    : !primary
      ? 'No annotated primary target is engaged in this experiment.'
      : !next
        ? 'No other protein is engaged: the window is not bounded.'
        : null;

  return {
    tested,
    engaged: proteins.length,
    engaged_without_pec50: proteins.length - withPotency.length,
    s_score: {
      pec50_min: pec50Min,
      ec50_max_molar: Number((10 ** -pec50Min).toPrecision(12)),
      engaged: sEngaged,
      tested,
      score: tested ? sEngaged / tested : null,
    },
    window: {
      primary: primary ? { feature_id: primary.feature_id, pec50: primary.pec50 } : null,
      next: primary && next ? { feature_id: next.feature_id, pec50: next.pec50 } : null,
      delta: primary && next ? round(primary.pec50 - next.pec50) : null,
      note,
    },
    proteins,
  };
}
