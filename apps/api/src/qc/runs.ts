// protein_quant rows → runs (Phase 27, QCD-01/02). Pure, so every counting rule is unit-tested.
import type { QcColorBy } from '@tributary/contracts';

type Row = Record<string, unknown>;

export interface CollectedRun {
  sample_key: string;
  instrument_run: string | null;
  /** Protein-group key → log2 intensity, for quantified cells only. */
  values: Map<string, number>;
}

export interface Collected {
  /** In first-appearance order. */
  runs: CollectedRun[];
  proteinGroups: number;
  /** Distinct normalisation values the source reports ("not reported" when a row has none). */
  normalisation: string[];
  /** Cells the source marks as imputed: never counted as identifications. */
  imputedCells: number;
  /** Quantified cells without a log2 intensity in the release (log2 derived here). */
  derivedLog2: number;
  /** Rows without a sample or protein group (cannot be placed). */
  droppedRows: number;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A protein group's accessions, sorted (the original string is kept in the release; order is not meaning). */
export function groupKey(row: Row): string {
  const ids = Array.isArray(row.protein_ids)
    ? row.protein_ids.map(text).filter(Boolean)
    : text(row.protein_group)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
  return [...new Set(ids)].sort().join(';');
}

export function collectRuns(rows: Row[]): Collected {
  const runs = new Map<string, CollectedRun>();
  const groups = new Set<string>();
  const normalisation = new Set<string>();
  let imputedCells = 0;
  let derivedLog2 = 0;
  let droppedRows = 0;
  for (const row of rows) {
    const sample = text(row.sample_key);
    const group = groupKey(row);
    if (!sample || !group) {
      droppedRows++;
      continue;
    }
    const instrument = text(row.instrument_run) || null;
    const key = `${sample}\u0000${instrument ?? ''}`;
    let run = runs.get(key);
    if (!run) {
      run = { sample_key: sample, instrument_run: instrument, values: new Map() };
      runs.set(key, run);
    }
    groups.add(group);
    normalisation.add(text(row.normalisation) || 'not reported');
    if (row.is_imputed === true) {
      imputedCells++;
      continue;
    }
    // Quantified: intensity > 0, or (no intensity) a finite log2 intensity. Missing or ≤ 0 = not quantified.
    const intensity = finite(row.intensity) ? row.intensity : null;
    if (intensity !== null && !(intensity > 0)) continue;
    if (finite(row.log2_intensity)) run.values.set(group, row.log2_intensity);
    else if (intensity !== null) {
      run.values.set(group, Math.log2(intensity));
      derivedLog2++;
    }
  }
  return {
    runs: [...runs.values()],
    proteinGroups: groups.size,
    normalisation: [...normalisation].sort(),
    imputedCells,
    derivedLog2,
    droppedRows,
  };
}

/** Legend label of a run. Plates and conditions are named within their experiment (labels repeat across them). */
export function colourLabel(
  run: {
    experiment_name: string;
    program_code: string;
    experiment_date: string | null;
    factors: Record<string, string>;
  },
  colorBy: QcColorBy,
): string {
  if (colorBy === 'experiment') return `${run.program_code} · ${run.experiment_name}`;
  if (colorBy === 'experiment_date') return run.experiment_date ?? 'no date';
  return `${run.experiment_name} · ${run.factors[colorBy] ?? 'not recorded'}`;
}

/** A warning when the pooled releases report different normalisations (PC1 may then separate them). */
export function normalisationNote(perExperiment: string[][]): string | null {
  const distinct = new Set(perExperiment.map((n) => n.join(' + ')));
  return distinct.size > 1
    ? `The source normalisation differs between experiments (${[...distinct].join('; ')}): components may separate normalisation or tool, not batch.`
    : null;
}
