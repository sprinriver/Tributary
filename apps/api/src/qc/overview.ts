// Cross-experiment QC (Phase 27, QCD-01/02): per-run metrics, outlier runs and a PCA of runs. Medians and the PCA
// come from apps/compute; this module only counts, selects and records what it did.
import {
  GroupSummaryResultSchema,
  PcaResultSchema,
  QC_LOW_ID_FRACTION,
  type QcOverview,
  type QcOverviewBody,
  type QcRun,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { computeCall } from '../charts/compute.ts';
import type { ApiConfig } from '../config.ts';
import { pcaFigure, trendFigure } from './figures.ts';
import { latestReleases, readRelease, type QcRelease } from './read.ts';
import { colourLabel, normalisationNote } from './runs.ts';

/** compute's group-summary takes at most this many groups per call. */
const GROUPS_PER_CALL = 200;
/** Cells (runs × protein groups) sent to one PCA. */
const MAX_PCA_CELLS = 2_000_000;
const MIN_PCA_RUNS = 3;
const MIN_PCA_FEATURES = 2;

type Deps = { db: Database; config: ApiConfig; fetch: typeof fetch };

async function medians(deps: Deps, groups: { name: string; values: number[] }[]) {
  const call = computeCall(deps.config, deps.fetch)('/stats/group-summary', GroupSummaryResultSchema, {});
  const out = new Map<string, number | null>();
  let version = '';
  // Empty groups have no median (and compute wants at least one value per group).
  const filled = groups.filter((g) => g.values.length > 0);
  for (let i = 0; i < filled.length; i += GROUPS_PER_CALL) {
    const res = await call({ groups: filled.slice(i, i + GROUPS_PER_CALL) });
    version = res.compute_version;
    for (const g of res.groups) out.set(g.name, g.median);
  }
  return { out, version };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function qcOverview(
  deps: Deps,
  readable: string[] | null,
  body: QcOverviewBody,
): Promise<QcOverview> {
  const chosen = await latestReleases(deps.db, readable, body.program_id, body.max_experiments);
  const skipped: QcOverview['provenance']['skipped'] = [];
  const releases: QcRelease[] = [];
  for (const exp of chosen) {
    const read = await readRelease(deps, exp);
    if ('release' in read) releases.push(read.release);
    else skipped.push({ experiment_name: exp.experiment_name, reason: read.skipped });
  }

  // Per-run counts; medians of quantified log2 intensities from compute (one group per run).
  const flat = releases.flatMap((r) => r.runs.map((run, i) => ({ r, run, key: `${r.release_id}|${i}` })));
  const runMedians = await medians(
    deps,
    flat.map(({ run, key }) => ({ name: key, values: [...run.values.values()] })),
  );
  const expMedians = await medians(
    deps,
    releases.map((r) => ({ name: r.release_id, values: r.runs.map((run) => run.values.size) })),
  );

  const runs: QcRun[] = flat.map(({ r, run, key }) => {
    const median = expMedians.out.get(r.release_id) ?? null;
    const ids = run.values.size;
    return {
      experiment_id: r.experiment_id,
      experiment_name: r.experiment_name,
      experiment_date: r.experiment_date,
      program_code: r.program_code,
      release_id: r.release_id,
      sample_key: run.sample_key,
      instrument_run: run.instrument_run,
      ids,
      missing_pct: r.proteinGroups ? (100 * (r.proteinGroups - ids)) / r.proteinGroups : 0,
      median_log2_intensity: runMedians.out.get(key) ?? null,
      flagged: median !== null && median > 0 && ids < QC_LOW_ID_FRACTION * median,
      factors: { ...r.factors.get(run.sample_key) },
    };
  });

  // PCA: unflagged runs × protein groups quantified in every one of them (complete cases), log2 intensities.
  const keptIdx = runs.flatMap((r, i) => (r.flagged ? [] : [i]));
  const kept = keptIdx.map((i) => runs[i]!);
  const flagged = runs.length - kept.length;
  const values = keptIdx.map((i) => flat[i]!.run.values);
  let features: string[] = [];
  if (values.length > 0) {
    const [first, ...rest] = [...values].sort((a, b) => a.size - b.size);
    features = [...first!.keys()].filter((g) => rest.every((m) => m.has(g))).sort();
  }
  let pca: QcOverview['figures']['pca'] = null;
  let explained: number[] | null = null;
  let pcaVersion = '';
  const notes: string[] = [];
  if (kept.length < MIN_PCA_RUNS)
    notes.push(`A PCA needs at least 3 runs that are not flagged (${kept.length} here).`);
  else if (features.length < MIN_PCA_FEATURES)
    notes.push(`A PCA needs at least 2 protein groups quantified in every run (${features.length} here).`);
  else if (kept.length * features.length > MAX_PCA_CELLS)
    notes.push(
      `Too many runs × protein groups for one PCA (${kept.length} × ${features.length}): choose fewer experiments.`,
    );
  else {
    const res = await computeCall(deps.config, deps.fetch)('/stats/pca', PcaResultSchema, {})({
      values: values.map((m) => features.map((g) => m.get(g)!)),
      scale: false,
      components: 2,
    });
    pcaVersion = res.compute_version;
    explained = res.explained_variance_ratio;
    pca = pcaFigure(
      kept,
      res.scores,
      explained,
      kept.map((r) => colourLabel(r, body.color_by)),
      body.color_by,
    );
  }
  if (flagged) notes.push(`${plural(flagged, 'flagged run')} left out of the PCA.`);
  const pooled = new Set(kept.map((r) => r.release_id));
  const normNote = normalisationNote(
    releases.filter((r) => pooled.has(r.release_id)).map((r) => r.normalisation),
  );
  if (pca && normNote) notes.push(normNote);

  const experiments = releases.map((r) => {
    const mine = runs.filter((x) => x.release_id === r.release_id);
    return {
      experiment_id: r.experiment_id,
      experiment_name: r.experiment_name,
      experiment_date: r.experiment_date,
      program_code: r.program_code,
      release_id: r.release_id,
      dataset_name: r.dataset_name,
      importer: r.importer,
      normalisation: r.normalisation,
      imputed_cells: r.imputedCells,
      derived_log2: r.derivedLog2,
      dropped_rows: r.droppedRows,
      runs: mine.length,
      median_ids: expMedians.out.get(r.release_id) ?? null,
      flagged_runs: mine.filter((x) => x.flagged).length,
    };
  });
  const compute: Record<string, string> = {};
  if (runMedians.version) compute.median = runMedians.version;
  if (pcaVersion) compute.pca = pcaVersion;
  const sum = (f: (r: QcRelease) => number) => releases.reduce((n, r) => n + f(r), 0);
  return {
    runs,
    experiments,
    figures: { trend: trendFigure(runs), pca },
    provenance: {
      release_ids: releases.map((r) => r.release_id),
      color_by: body.color_by,
      pca_features: pca ? features.length : null,
      pca_explained: explained,
      pca_note: notes.length ? notes.join(' ') : null,
      skipped,
      transformations: [
        'A run is one sample × instrument run of the latest published protein-quantity release of each experiment',
        'Quantified = intensity > 0, or a log2 intensity when no intensity is given; missing or ≤ 0 = not quantified',
        `Imputed cells (as marked by the source) are not identifications: ${sum((r) => r.imputedCells)} left out`,
        'No q-value filter: IDs are protein groups as reported by the source tool',
        "% missing = protein groups of the experiment's release not quantified in the run",
        `Median log2 intensity of the quantified protein groups; log2 derived from intensity for ${sum((r) => r.derivedLog2)} cells without one`,
        `Flagged: IDs < ${QC_LOW_ID_FRACTION} × the experiment's median IDs (never in a one-run experiment, nor when that median is 0)`,
        'PCA: unflagged runs × protein groups quantified in every one of them (complete cases; groups matched by their sorted accessions), log2 intensity, centred, not scaled',
        `Rows without a sample or protein group: ${sum((r) => r.droppedRows)} left out`,
        'No normalisation, imputation or filtering beyond the above is applied by Tributary',
      ],
      compute,
    },
  };
}
