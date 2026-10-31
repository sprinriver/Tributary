import type { ChartSpec, ClusterResult, DendrogramOptions, HeatmapOptions } from '@tributary/contracts';
import { clusterOf, links, type Tree } from './dendro.ts';
import { dataError } from './errors.ts';
import {
  buildMatrix,
  clusterMatrix,
  heatmapTrace,
  reorder,
  scaleMatrix,
  type Cluster,
  type Matrix,
} from './matrix.ts';
import type { Shaped } from './volcano.ts';

type Row = Record<string, unknown>;
const PALETTE = ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#1f78b4'];
const GRADIENT = ['#c6dbef', '#6baed6', '#2171b5', '#08306b'];
const LINK = '#444c56';

/** Rows that became incomplete after z-scoring (constant rows) cannot be clustered either; drop and count them. */
function dropIncomplete(m: Matrix): number {
  const keep = m.z.map((row) => row.every((v) => v !== null));
  m.rowLabels = m.rowLabels.filter((_, i) => keep[i]);
  m.z = m.z.filter((_, i) => keep[i]);
  return keep.filter((k) => !k).length;
}

function computeInfo(res: ClusterResult | null): Record<string, string | number> {
  return res ? { cluster: res.compute_version, method: res.method, metric: res.metric, seed: res.seed } : {};
}

/** Link traces (one per colour) in (leaf position, height) space, mapped to x/y by `place`. */
function linkTraces(
  tree: Tree,
  o: {
    interpolation: 'step' | 'linear';
    color_scheme: 'single' | 'gradient' | 'cluster';
    color_threshold?: number | undefined;
  },
  place: (pos: number, h: number) => [number, number],
  axes: { xaxis: string; yaxis: string },
) {
  const { links: segs, nodes } = links(tree, o.interpolation);
  const maxH = Math.max(...segs.map((s) => s.h), 1e-12);
  const threshold = o.color_threshold ?? 0.7 * maxH;
  const clusters = o.color_scheme === 'cluster' ? clusterOf(tree, threshold) : [];
  const colourOf = (k: number, h: number) =>
    o.color_scheme === 'single'
      ? LINK
      : o.color_scheme === 'gradient'
        ? GRADIENT[Math.min(GRADIENT.length - 1, Math.floor((h / maxH) * GRADIENT.length))]!
        : clusters[k] === null
          ? '#9aa5b1'
          : PALETTE[clusters[k]! % PALETTE.length]!;
  const byColour = new Map<string, { x: (number | null)[]; y: (number | null)[] }>();
  for (const s of segs) {
    const c = colourOf(s.k, s.h);
    const t = byColour.get(c) ?? { x: [], y: [] };
    s.pos.forEach((p, i) => {
      const [x, y] = place(p, s.height[i]!);
      t.x.push(x);
      t.y.push(y);
    });
    t.x.push(null);
    t.y.push(null);
    byColour.set(c, t);
  }
  const traces = [...byColour].map(([colour, t]) => ({
    type: 'scatter',
    mode: 'lines',
    x: t.x,
    y: t.y,
    line: { color: colour, width: 1.5 },
    hoverinfo: 'skip',
    showlegend: false,
    ...axes,
  }));
  const annotations = tree.support
    ? nodes.map((n) => {
        const [x, y] = place(n.pos, n.h);
        return {
          x,
          y,
          xref: axes.xaxis,
          yref: axes.yaxis,
          text: `${Math.round(tree.support![n.k]! * 100)}`,
          showarrow: false,
          font: { size: 9, color: '#c0392b' },
        };
      })
    : [];
  return { traces, annotations };
}

export async function shapeHeatmap(
  rows: Row[],
  spec: ChartSpec,
  o: HeatmapOptions,
  cluster: Cluster,
): Promise<Shaped> {
  const clustering = o.cluster_rows || o.cluster_columns;
  const m = buildMatrix(rows, spec, clustering);
  if (!clustering && m.z.length < 2)
    throw dataError('too_few_rows', 'encodings.values', 'A heatmap needs at least 2 rows.');
  const transformations = scaleMatrix(m, o.scale);
  const dropped = m.dropped + (clustering ? dropIncomplete(m) : 0);
  const axis =
    o.cluster_rows && o.cluster_columns
      ? 'both'
      : o.cluster_rows
        ? 'rows'
        : o.cluster_columns
          ? 'columns'
          : null;
  const res = await clusterMatrix(m, axis, o, cluster);
  reorder(m, res?.rows?.order ?? null, res?.columns?.order ?? null);
  const data: Record<string, unknown>[] = [heatmapTrace(m, o)];
  const layout: Record<string, unknown> = {
    xaxis: { title: { text: spec.axes?.x?.title ?? '' }, showgrid: false },
    yaxis: { title: { text: spec.axes?.y?.title ?? '' }, showgrid: false, automargin: true },
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  const annotations: Record<string, unknown>[] = [];
  if (o.dendrograms && res?.rows) {
    const d = linkTraces(
      { ...res.rows, order: res.rows.order },
      { interpolation: 'step', color_scheme: 'single' },
      (p, h) => [h, p],
      { xaxis: 'x2', yaxis: 'y' },
    );
    data.push(...d.traces);
    annotations.push(...d.annotations);
    (layout.xaxis as Record<string, unknown>).domain = [0.15, 1];
    layout.xaxis2 = {
      domain: [0, 0.13],
      anchor: 'y',
      autorange: 'reversed',
      showticklabels: false,
      showgrid: false,
      zeroline: false,
    };
  }
  if (o.dendrograms && res?.columns) {
    const d = linkTraces(res.columns, { interpolation: 'step', color_scheme: 'single' }, (p, h) => [p, h], {
      xaxis: 'x',
      yaxis: 'y2',
    });
    data.push(...d.traces);
    annotations.push(...d.annotations);
    (layout.yaxis as Record<string, unknown>).domain = [0, 0.85];
    layout.yaxis2 = {
      domain: [0.87, 1],
      anchor: 'x',
      showticklabels: false,
      showgrid: false,
      zeroline: false,
    };
  }
  layout.annotations = annotations;
  return { data, layout, rows: m.z.length, dropped, transformations, compute: computeInfo(res) };
}

export async function shapeDendrogram(
  rows: Row[],
  spec: ChartSpec,
  o: DendrogramOptions,
  cluster: Cluster,
): Promise<Shaped> {
  const m = buildMatrix(rows, spec, true);
  const transformations = scaleMatrix(m, o.standardize);
  const dropped = m.dropped + dropIncomplete(m);
  const res = await clusterMatrix(m, o.axis, o, cluster);
  const unordered = { rows: [...m.rowLabels], cols: [...m.colLabels] };
  reorder(m, res?.rows?.order ?? null, res?.columns?.order ?? null);
  const trees: { tree: Tree; labels: string[] }[] = [];
  if (res?.rows) trees.push({ tree: res.rows, labels: res.rows.order.map((i) => unordered.rows[i]!) });
  if (res?.columns)
    trees.push({ tree: res.columns, labels: res.columns.order.map((j) => unordered.cols[j]!) });
  if (!trees.length) throw dataError('too_few_rows', 'encodings.values', 'Nothing to cluster.');

  const vertical = o.orientation === 'top' || o.orientation === 'bottom';
  const place = (p: number, h: number): [number, number] => (vertical ? [p, h] : [h, p]);
  const data: Record<string, unknown>[] = [];
  const annotations: Record<string, unknown>[] = [];
  const layout: Record<string, unknown> = {
    showlegend: false,
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  const share = o.attach_heatmap || trees.length > 1 ? 0.35 : 1;
  trees.forEach(({ tree, labels }, i) => {
    const xa = i === 0 ? 'x' : 'x2';
    const ya = i === 0 ? 'y' : 'y2';
    const d = linkTraces(tree, o, place, { xaxis: xa, yaxis: ya });
    data.push(...d.traces);
    annotations.push(...d.annotations);
    const leafAxis = {
      tickvals: labels.map((_, k) => k),
      ticktext: labels,
      showgrid: false,
      zeroline: false,
      automargin: true,
    };
    const heightAxis = {
      title: { text: `height (${o.method}, ${o.metric})` },
      showgrid: vertical ? spec.layout.gridY : spec.layout.gridX,
      zeroline: false,
      ...(o.orientation === 'left' || o.orientation === 'bottom' ? { autorange: 'reversed' } : {}),
    };
    const domain = i === 0 ? [0, share] : [share + 0.05, 1];
    const suffix = i === 0 ? '' : '2';
    layout[`xaxis${suffix}`] = {
      ...(vertical ? leafAxis : heightAxis),
      ...(vertical ? { domain } : {}),
      anchor: ya,
    };
    layout[`yaxis${suffix}`] = {
      ...(vertical ? heightAxis : leafAxis),
      ...(vertical ? {} : { domain }),
      anchor: xa,
    };
  });
  if (o.attach_heatmap) {
    // The heatmap shares the first tree's leaf axis (leaf positions 0…n−1 are category indices).
    const byRows = trees[0]!.tree === res?.rows;
    const shown: Matrix = byRows
      ? m
      : {
          ...m,
          rowLabels: m.colLabels,
          colLabels: m.rowLabels,
          z: m.colLabels.map((_, j) => m.z.map((r) => r[j]!)),
        };
    data.push(
      heatmapTrace(
        shown,
        { centered: o.standardize !== 'none', min: undefined, max: undefined },
        vertical ? { x: 'x', y: 'y3' } : { x: 'x3', y: 'y' },
      ),
    );
    if (vertical) layout.yaxis3 = { domain: [share + 0.05, 1], anchor: 'x', automargin: true };
    else layout.xaxis3 = { domain: [share + 0.05, 1], anchor: 'y' };
  }
  layout.annotations = annotations;
  return {
    data,
    layout,
    rows: m.z.length,
    dropped,
    transformations,
    compute: { ...computeInfo(res), bootstrap_n: o.bootstrap_n },
  };
}
