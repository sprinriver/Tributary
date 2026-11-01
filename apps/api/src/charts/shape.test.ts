import {
  chartDefaults,
  type ChartSpec,
  type ClusterResult,
  type DendrogramOptions,
  type HeatmapOptions,
  type VolcanoOptions,
} from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import { shapeDendrogram, shapeHeatmap } from './figures.ts';
import { shapeVolcano } from './volcano.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const layout = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};
const spec = (type: ChartSpec['type'], encodings: ChartSpec['encodings']): ChartSpec =>
  ({
    type,
    data: { savedViewId: '019a2b3c-4d5e-7f00-8a00-000000000003' },
    encodings,
    options: {},
    layout,
  }) as ChartSpec;

const rows = [
  { id: 'A', fc: 2.5, p: 1e-6, s1: 1, s2: 2, s3: 3 },
  { id: 'B', fc: -1.8, p: 1e-4, s1: 3, s2: 1, s3: 2 },
  { id: 'C', fc: 0.2, p: 0.5, s1: 2, s2: 2.5, s3: 9 },
  { id: 'D', fc: 1.2, p: 0.2, s1: 8, s2: 1, s3: 4 },
  { id: 'E', fc: -3, p: 0.01, s1: 0, s2: 5, s3: 1 },
];
const vSpec = spec('volcano', { x: 'fc', y: 'p', label: 'id' });
const volcano = (o: Partial<VolcanoOptions> = {}): Json =>
  shapeVolcano(rows, vSpec, { ...(chartDefaults('volcano') as VolcanoOptions), ...o });
const names = (s: Json) => s.data.map((t: Json) => t.name);
const xs = (s: Json) => s.data.flatMap((t: Json) => t.x);

/** Clusters by reversing (stands in for apps/compute, whose clustering is tested in pytest). */
const cluster = async (body: Record<string, unknown>): Promise<ClusterResult> => {
  const values = body.values as number[][];
  const tree = (n: number) => ({
    order: [...Array(n).keys()].reverse(),
    linkage: [...Array(n - 1).keys()].map((k) => [k === 0 ? 0 : n + k - 1, k + 1, k + 1, k + 2]),
    support: (body.bootstrap_n as number) > 0 ? [...Array(n - 1).keys()].map(() => 0.8) : null,
    bootstrap_valid: (body.bootstrap_n as number) > 0 ? (body.bootstrap_n as number) : null,
  });
  return {
    rows: body.axis === 'columns' ? null : tree(values.length),
    columns: body.axis === 'rows' ? null : tree(values[0]!.length),
    seed: body.seed as number,
    method: body.method as string,
    metric: body.metric as string,
    compute_version: 'test',
  };
};
const mSpec = spec('heatmap', { values: ['s1', 's2', 's3'], rowLabel: 'id' });
const heatmap = (o: Partial<HeatmapOptions> = {}): Promise<Json> =>
  shapeHeatmap(rows, mSpec, { ...(chartDefaults('heatmap') as HeatmapOptions), ...o }, cluster);
const dSpec = spec('dendrogram', { values: ['s1', 's2', 's3'], rowLabel: 'id' });
const dendrogram = (o: Partial<DendrogramOptions> = {}): Promise<Json> =>
  shapeDendrogram(rows, dSpec, { ...(chartDefaults('dendrogram') as DendrogramOptions), ...o }, cluster);

describe('every chart option changes the output (REFERENCE_V1 §8: no dead options)', () => {
  it('VIZ-02: volcano options', () => {
    const base = volcano();
    expect(names(base)).toEqual(['Up (1)', 'Down (2)', 'Not significant (2)']);
    expect(names(volcano({ fc_threshold: 2 }))).toEqual(['Up (1)', 'Down (1)', 'Not significant (3)']);
    expect(names(volcano({ p_threshold: 0.3 }))).toEqual(['Up (2)', 'Down (2)', 'Not significant (1)']);
    expect(base.data[0]!.y[0]).toBeCloseTo(6);
    expect(volcano({ y_transform: 'none' }).data.flatMap((t: Json) => t.y)).toContain(1e-6);
    expect(volcano({ label_top: 2 }).layout.annotations).toHaveLength(2);
    expect(base.layout.annotations).toHaveLength(0);
    expect(xs(volcano({ pseudolog_x: true }))).not.toEqual(xs(base));
    expect(xs(volcano({ pseudolog_x: true, pseudolog_base: 2 }))).not.toEqual(
      xs(volcano({ pseudolog_x: true })),
    );
    const py = volcano({ y_transform: 'none', pseudolog_y: true });
    expect(py.data.flatMap((t: Json) => t.y)).not.toEqual(
      volcano({ y_transform: 'none' }).data.flatMap((t: Json) => t.y),
    );
    expect(xs(volcano({ standardize_x: true, fc_threshold: 0 }))).not.toEqual(
      xs(volcano({ fc_threshold: 0 })),
    );
    expect(volcano({ webgl: false }).data[0]!.type).toBe('scatter');
    expect(base.data[0]!.type).toBe('scattergl');
  });

  it('VIZ-02: volcano review fixes — thresholds in plotted space, ranking when y is −log10 p, constant x', () => {
    const lines = (s: Json) => s.layout.shapes.map((sh: Json) => [sh.x0, sh.y0]);
    // y already −log10(p): the line sits at −log10(0.05), and the most significant hits are the largest y.
    const transformed = shapeVolcano(
      rows.map((r) => ({ ...r, p: -Math.log10(r.p) })),
      vSpec,
      { ...(chartDefaults('volcano') as VolcanoOptions), y_transform: 'none', label_top: 1 },
    ) as Json;
    expect(transformed.layout.shapes.at(-1).y0).toBeCloseTo(-Math.log10(0.05), 9);
    expect(transformed.layout.annotations[0].text).toBe('A');
    expect(volcano({ label_top: 1 }).layout.annotations[0].text).toBe('A');
    // Pseudolog X moves the fold-change lines with the points.
    expect(lines(volcano({ pseudolog_x: true }))[1][0]).toBeCloseTo(Math.asinh(0.5) / Math.log(10), 9);
    expect(lines(volcano({ pseudolog_y: true, y_transform: 'none' })).at(-1)[1]).toBeCloseTo(
      Math.asinh(-Math.log10(0.05) / 2) / Math.log(10),
      9,
    );
    const flat = rows.map((r) => ({ ...r, fc: 1 }));
    expect(() =>
      shapeVolcano(flat, vSpec, {
        ...(chartDefaults('volcano') as VolcanoOptions),
        standardize_x: true,
        fc_threshold: 0,
      }),
    ).toThrow(/does not vary/);
  });

  it('VIZ-03: z-scoring a constant column names it instead of dropping every row', async () => {
    const constant = rows.map((r) => ({ ...r, s2: 4 }));
    await expect(
      shapeHeatmap(
        constant,
        mSpec,
        { ...(chartDefaults('heatmap') as HeatmapOptions), scale: 'zscore_columns', cluster_rows: true },
        cluster,
      ),
    ).rejects.toMatchObject({ body: { code: 'constant_column', field: 'options.scale' } });
  });

  it('VIZ-03: heatmap options', async () => {
    const base = await heatmap();
    const heat = (s: Json) => s.data.find((t: Json) => t.type === 'heatmap')!;
    expect(heat(base).y).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(heat(await heatmap({ scale: 'zscore_rows' })).z[0]).toEqual([-1, 0, 1]);
    expect(heat(await heatmap({ scale: 'zscore_columns' })).z).not.toEqual(heat(base).z);
    expect(heat(await heatmap({ min: 0, max: 5 }))).toMatchObject({ zmin: 0, zmax: 5 });
    expect(heat(await heatmap({ centered: true }))).toMatchObject({ zmid: 0, colorscale: 'RdBu' });
    expect(heat(await heatmap({ cluster_rows: true })).y).toEqual(['E', 'D', 'C', 'B', 'A']);
    expect(heat(await heatmap({ cluster_columns: true })).x).toEqual(['s3', 's2', 's1']);
    const withTrees = await heatmap({ cluster_rows: true, cluster_columns: true, dendrograms: true });
    expect(withTrees.data.filter((t: Json) => t.type === 'scatter').length).toBeGreaterThanOrEqual(2);
    expect(withTrees.layout).toHaveProperty('xaxis2');
    expect(withTrees.layout).toHaveProperty('yaxis2');
    for (const key of ['method', 'metric', 'leaf_ordering'] as const) {
      const sent: Json[] = [];
      await shapeHeatmap(
        rows,
        mSpec,
        {
          ...(chartDefaults('heatmap') as HeatmapOptions),
          cluster_rows: true,
          [key]: key === 'method' ? 'complete' : key === 'metric' ? 'cosine' : 'optimal',
        },
        async (b) => {
          sent.push(b);
          return cluster(b);
        },
      );
      expect(sent[0]![key]).toBe(key === 'method' ? 'complete' : key === 'metric' ? 'cosine' : 'optimal');
    }
  });

  it('VIZ-03: dendrogram options', async () => {
    const base = await dendrogram();
    const lines = (s: Json) => s.data.filter((t: Json) => t.mode === 'lines');
    expect(base.layout.yaxis.ticktext).toEqual(['E', 'D', 'C', 'B', 'A']);
    expect((await dendrogram({ axis: 'columns' })).layout.yaxis.ticktext).toEqual(['s3', 's2', 's1']);
    expect((await dendrogram({ axis: 'both' })).layout).toHaveProperty('xaxis2');
    expect((await dendrogram({ orientation: 'top' })).layout.xaxis.ticktext).toEqual([
      'E',
      'D',
      'C',
      'B',
      'A',
    ]);
    expect(base.layout.xaxis.autorange).toBe('reversed');
    expect((await dendrogram({ orientation: 'right' })).layout.xaxis.autorange).toBeUndefined();
    expect((await dendrogram({ orientation: 'bottom' })).layout.yaxis.autorange).toBe('reversed');
    expect(lines(await dendrogram({ interpolation: 'linear' }))[0]!.x.length).toBeLessThan(
      lines(base)[0]!.x.length,
    );
    expect(lines(await dendrogram({ color_scheme: 'gradient' })).length).toBeGreaterThan(1);
    expect(
      lines(await dendrogram({ color_scheme: 'cluster', color_threshold: 3.5 })).map(
        (t: Json) => t.line.color,
      ),
    ).toContain('#9aa5b1');
    expect((await dendrogram({ bootstrap_n: 10 })).layout.annotations).toHaveLength(4);
    expect(base.layout.annotations).toHaveLength(0);
    expect((await dendrogram({ seed: 9, bootstrap_n: 10 })).compute).toMatchObject({
      seed: 9,
      bootstrap_n: 10,
    });
    expect((await dendrogram({ attach_heatmap: true })).data.some((t: Json) => t.type === 'heatmap')).toBe(
      true,
    );
    expect((await dendrogram({ standardize: 'zscore_rows' })).transformations).toEqual([
      'rows z-scored (sample SD)',
    ]);
    for (const [key, value] of [
      ['method', 'single'],
      ['metric', 'canberra'],
      ['leaf_ordering', 'optimal'],
    ] as const) {
      const sent: Json[] = [];
      await shapeDendrogram(
        rows,
        dSpec,
        { ...(chartDefaults('dendrogram') as DendrogramOptions), [key]: value },
        async (b) => {
          sent.push(b);
          return cluster(b);
        },
      );
      expect(sent[0]![key]).toBe(value);
    }
  });
});
