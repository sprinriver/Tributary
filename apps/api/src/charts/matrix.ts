import type { ChartSpec, ClusterResult, DendrogramOptions, HeatmapOptions } from '@tributary/contracts';
import { dataError } from './errors.ts';
import { toLabel, toNumber, zscore } from './transforms.ts';
import type { Shaped } from './volcano.ts';

type Row = Record<string, unknown>;
export type Cluster = (body: Record<string, unknown>) => Promise<ClusterResult>;

export interface Matrix {
  rowLabels: string[];
  colLabels: string[];
  z: (number | null)[][];
  dropped: number;
}

/** Rows × columns from wide (several values columns) or long (x categories + one values column) data. */
export function buildMatrix(rows: Row[], spec: ChartSpec, dropIncomplete: boolean): Matrix {
  const enc = spec.encodings as Record<string, string | string[] | undefined>;
  const values = ([] as string[]).concat(enc.values ?? []);
  const rowLabel = enc.rowLabel as string;
  let rowLabels: string[];
  let colLabels: string[];
  let z: (number | null)[][];
  if (enc.x) {
    const x = enc.x as string;
    colLabels = [...new Set(rows.map((r) => toLabel(r[x])))];
    const index = new Map<string, number>();
    rowLabels = [];
    z = [];
    for (const r of rows) {
      const label = toLabel(r[rowLabel]);
      if (!index.has(label)) {
        index.set(label, rowLabels.length);
        rowLabels.push(label);
        z.push(colLabels.map(() => null));
      }
      const cell = z[index.get(label)!]!;
      const j = colLabels.indexOf(toLabel(r[x]));
      if (cell[j] !== null)
        throw dataError(
          'duplicate_cells',
          'encodings.x',
          `More than one value for ${label} × ${colLabels[j]}; filter first.`,
        );
      cell[j] = toNumber(r[values[0]!]);
    }
  } else {
    colLabels = values;
    rowLabels = rows.map((r) => toLabel(r[rowLabel]));
    const seen = new Set<string>();
    for (const l of rowLabels) {
      if (seen.has(l))
        throw dataError(
          'duplicate_row_labels',
          'encodings.rowLabel',
          `"${l}" labels more than one row; pick a unique label or filter.`,
        );
      seen.add(l);
    }
    z = rows.map((r) => values.map((v) => toNumber(r[v])));
  }
  let dropped = 0;
  if (dropIncomplete) {
    const keep = z.map((row) => row.every((v) => v !== null));
    dropped = keep.filter((k) => !k).length;
    rowLabels = rowLabels.filter((_, i) => keep[i]);
    z = z.filter((_, i) => keep[i]);
  }
  return { rowLabels, colLabels, z, dropped };
}

export function scaleMatrix(m: Matrix, scale: 'none' | 'zscore_rows' | 'zscore_columns'): string[] {
  if (scale === 'zscore_rows') m.z = m.z.map((row) => zscore(row));
  if (scale === 'zscore_columns') {
    const cols = m.colLabels.map((_, j) => zscore(m.z.map((row) => row[j]!)));
    m.z = m.z.map((_, i) => cols.map((col) => col[i]!));
  }
  return scale === 'none' ? [] : [`${scale === 'zscore_rows' ? 'rows' : 'columns'} z-scored (sample SD)`];
}

export function reorder(m: Matrix, rows: number[] | null, cols: number[] | null): void {
  if (rows) {
    m.rowLabels = rows.map((i) => m.rowLabels[i]!);
    m.z = rows.map((i) => m.z[i]!);
  }
  if (cols) {
    m.colLabels = cols.map((j) => m.colLabels[j]!);
    m.z = m.z.map((row) => cols.map((j) => row[j]!));
  }
}

/** Calls apps/compute when clustering is asked for; checks the minimum rows first. */
export async function clusterMatrix(
  m: Matrix,
  axis: 'rows' | 'columns' | 'both' | null,
  o: { method: string; metric: string; leaf_ordering: string; bootstrap_n?: number; seed?: number },
  cluster: Cluster,
): Promise<ClusterResult | null> {
  if (!axis) return null;
  if ((axis !== 'columns' && m.z.length < 2) || m.z.length === 0)
    throw dataError(
      'too_few_rows',
      'encodings.values',
      `Clustering needs at least 2 complete rows (${m.z.length} left after dropping rows with missing values).`,
    );
  return cluster({
    values: m.z,
    row_labels: m.rowLabels,
    column_labels: m.colLabels,
    axis,
    method: o.method,
    metric: o.metric,
    leaf_ordering: o.leaf_ordering,
    bootstrap_n: o.bootstrap_n ?? 0,
    seed: o.seed ?? 1,
  });
}

export function heatmapTrace(
  m: Matrix,
  o: Pick<HeatmapOptions, 'centered' | 'min' | 'max'>,
  axes: { x?: string; y?: string } = {},
) {
  return {
    type: 'heatmap',
    z: m.z,
    x: m.colLabels,
    y: m.rowLabels,
    colorscale: o.centered ? 'RdBu' : 'Viridis',
    reversescale: o.centered,
    ...(o.centered ? { zmid: 0 } : {}),
    ...(o.min !== undefined ? { zmin: o.min } : {}),
    ...(o.max !== undefined ? { zmax: o.max } : {}),
    hoverongaps: false,
    ...(axes.x ? { xaxis: axes.x } : {}),
    ...(axes.y ? { yaxis: axes.y } : {}),
  };
}

export type { DendrogramOptions, Shaped };
