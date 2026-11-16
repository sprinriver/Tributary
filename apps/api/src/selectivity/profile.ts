// Compound selectivity profile (Phase 42, SEL-01): pure counting and selection over one profiling experiment's
// dose-response curves, so every rule is unit-tested. No statistics are computed here.
//
// S(x) after Karaman et al. 2008 (Nat Biotechnol 26:127, doi:10.1038/nbt1358): the fraction of tested proteins
// regulated at potency x or better. They used Kd (S(3 µM)); here the potency is the source tool's pEC50, an apparent
// potency in this assay (pEC50 = −log10(EC50 in M)), and "regulated" is the tool's own call (up and/or down).
// Tested = curves the tool classed (up, down or not); curves it left without a class ("unclear", CurveCurator
// SOURCE.md) are not an interpretable measurement and are counted apart.

export type KnownRole = 'primary_target' | 'off_target';
export type Direction = 'both' | 'down' | 'up';

/** Annotated targets by UniProt accession (no isoform suffix) and by upper-case gene symbol. */
export interface Known {
  accessions: Map<string, KnownRole>;
  genes: Map<string, KnownRole>;
}

export interface CurveRow {
  feature_id: string;
  protein_ids: unknown;
  gene_names: unknown;
  pec50: number | null;
  /** up, down, not or unclear (the importers' classes). */
  regulation: string;
  fdr: number | null;
  doses_molar: unknown;
}

export interface RegulatedProtein {
  feature_id: string;
  genes: string;
  pec50: number | null;
  regulation: string;
  fdr: number | null;
  known: KnownRole | null;
  /** A protein group of several accessions: the signal may come from any of them. */
  ambiguous: boolean;
  /** pEC50 beyond the tested doses (extrapolated by the fit). */
  outside_dose_range: boolean;
}

export interface SelectivityProfile {
  tested: number;
  unclassified: number;
  regulated: number;
  regulated_up: number;
  regulated_down: number;
  regulated_without_pec50: number;
  /** Features with more than one curve (one counted: its most potent regulated curve). */
  duplicates: number;
  /** pEC50 span of the tested doses (lowest and highest non-zero dose); null when doses are unknown. */
  dose_range: { pec50_low: number; pec50_high: number } | null;
  s_score: {
    pec50_min: number;
    ec50_max_molar: number;
    direction: Direction;
    regulated: number;
    tested: number;
    score: number | null;
  };
  window: {
    primary: { feature_id: string; pec50: number } | null;
    next: { feature_id: string; pec50: number } | null;
    /** primary pEC50 − next pEC50 (log units): > 0 means the primary target is regulated more potently. */
    delta: number | null;
    note: string | null;
  };
  /** Regulated proteins in the chosen direction, most potent first; those without a pEC50 last. */
  proteins: RegulatedProtein[];
  notes: string[];
}

const CLASSED = new Set(['up', 'down', 'not']);
const counts = (regulation: string, direction: Direction) =>
  direction === 'both' ? regulation === 'up' || regulation === 'down' : regulation === direction;
/** UniProt accessions without an isoform suffix ("P12345-2" → "P12345"). */
const base = (id: string) => id.trim().replace(/-\d+$/, '');
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
/** Rounds away binary noise (inputs carry far fewer decimals). */
const round = (x: number) => Math.round(x * 1e9) / 1e9;

function knownRole(r: CurveRow, known: Known): KnownRole | null {
  const accessions = list(r.protein_ids);
  // Gene-level features (no protein IDs) match by gene symbol, case-insensitively.
  const roles = accessions.length
    ? accessions.map((id) => known.accessions.get(base(id)))
    : [r.feature_id, ...list(r.gene_names)].map((g) => known.genes.get(g.trim().toUpperCase()));
  if (roles.includes('primary_target')) return 'primary_target';
  if (roles.includes('off_target')) return 'off_target';
  return null;
}

const isRegulated = (r: CurveRow) => r.regulation === 'up' || r.regulation === 'down';
const morePotent = (a: number | null, b: number | null) => (a ?? -Infinity) > (b ?? -Infinity);

/** One curve per feature: a regulated curve wins; among regulated ones the most potent; else the first in row order. */
function onePerFeature(rows: CurveRow[]) {
  const byFeature = new Map<string, CurveRow>();
  let duplicates = 0;
  const seenTwice = new Set<string>();
  for (const r of rows) {
    const seen = byFeature.get(r.feature_id);
    if (seen && !seenTwice.has(r.feature_id)) {
      seenTwice.add(r.feature_id);
      duplicates += 1;
    }
    if (
      !seen ||
      (isRegulated(r) && !isRegulated(seen)) ||
      (isRegulated(r) && isRegulated(seen) && morePotent(r.pec50, seen.pec50))
    )
      byFeature.set(r.feature_id, r);
  }
  return { chosen: [...byFeature.values()], duplicates };
}

function doseRange(rows: CurveRow[]) {
  const doses = rows.flatMap((r) =>
    Array.isArray(r.doses_molar)
      ? r.doses_molar.filter((d): d is number => typeof d === 'number' && d > 0)
      : [],
  );
  if (doses.length === 0) return null;
  return {
    pec50_low: round(-Math.log10(Math.max(...doses))),
    pec50_high: round(-Math.log10(Math.min(...doses))),
  };
}

export function selectivityProfile(
  rows: CurveRow[],
  known: Known,
  options: { pec50Min: number; direction: Direction },
): SelectivityProfile {
  const { pec50Min, direction } = options;
  const { chosen, duplicates } = onePerFeature(rows);
  const classed = chosen.filter((r) => CLASSED.has(r.regulation));
  const range = doseRange(rows);
  const outside = (p: number | null) =>
    range !== null && p !== null && (p < range.pec50_low || p > range.pec50_high);
  const regulatedAll = classed.filter(isRegulated);
  const proteins: RegulatedProtein[] = regulatedAll
    .filter((r) => counts(r.regulation, direction))
    .map((r) => ({
      feature_id: r.feature_id,
      genes: list(r.gene_names).join('; '),
      pec50: r.pec50,
      regulation: r.regulation,
      fdr: r.fdr,
      known: knownRole(r, known),
      ambiguous: list(r.protein_ids).length > 1,
      outside_dose_range: outside(r.pec50),
    }))
    .sort(
      (a, b) => (b.pec50 ?? -Infinity) - (a.pec50 ?? -Infinity) || a.feature_id.localeCompare(b.feature_id),
    );
  const tested = classed.length;
  const sRegulated = proteins.filter((p) => p.pec50 !== null && p.pec50 >= pec50Min).length;

  // The window, in the chosen direction.
  const withPotency = proteins.filter((p): p is RegulatedProtein & { pec50: number } => p.pec50 !== null);
  const primary = withPotency.find((p) => p.known === 'primary_target') ?? null;
  const next = withPotency.find((p) => p.known !== 'primary_target') ?? null;
  const anyPrimary = [...known.accessions.values(), ...known.genes.values()].includes('primary_target');
  const primaryRegulated = proteins.some((p) => p.known === 'primary_target');
  const othersRegulated = proteins.some((p) => p.known !== 'primary_target');
  const note = !anyPrimary
    ? 'No primary target is annotated for this compound.'
    : !primaryRegulated
      ? 'No annotated primary target is regulated in this experiment.'
      : !primary
        ? 'The annotated primary target is regulated but has no pEC50.'
        : !othersRegulated
          ? 'No other protein is regulated: the window is not bounded.'
          : !next
            ? 'The other regulated proteins have no pEC50: the window is not bounded.'
            : null;

  const unclassified = chosen.length - tested;
  const notes = [
    ...(unclassified
      ? [`${unclassified} curves without a class from the tool are not counted as tested.`]
      : []),
    ...(duplicates
      ? [
          `${duplicates} protein(s) have more than one curve: each counts once, with its most potent regulated curve.`,
        ]
      : []),
    ...(range && (pec50Min < range.pec50_low || pec50Min > range.pec50_high)
      ? [
          `The threshold pEC50 ${pec50Min} is outside the tested dose range (pEC50 ${range.pec50_low}–${range.pec50_high}): S(x) there rests on extrapolated fits.`,
        ]
      : []),
    ...(proteins.some((p) => p.outside_dose_range)
      ? [
          `${proteins.filter((p) => p.outside_dose_range).length} pEC50 value(s) lie outside the tested dose range.`,
        ]
      : []),
    ...(proteins.some((p) => p.ambiguous)
      ? ['Protein groups with several accessions are marked: their signal may come from any member.']
      : []),
  ];

  return {
    tested,
    unclassified,
    regulated: regulatedAll.length,
    regulated_up: regulatedAll.filter((r) => r.regulation === 'up').length,
    regulated_down: regulatedAll.filter((r) => r.regulation === 'down').length,
    regulated_without_pec50: proteins.length - withPotency.length,
    duplicates,
    dose_range: range,
    s_score: {
      pec50_min: pec50Min,
      ec50_max_molar: Number((10 ** -pec50Min).toPrecision(12)),
      direction,
      regulated: sRegulated,
      tested,
      score: tested ? sRegulated / tested : null,
    },
    window: {
      primary: primary ? { feature_id: primary.feature_id, pec50: primary.pec50 } : null,
      next: primary && next ? { feature_id: next.feature_id, pec50: next.pec50 } : null,
      delta: primary && next ? round(primary.pec50 - next.pec50) : null,
      note,
    },
    proteins,
    notes,
  };
}
