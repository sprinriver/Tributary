import { chartDefaults, type ChartSpec, type ChartType } from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import type { Compute } from './compute.ts';
import { shapeChart } from './dispatch.ts';

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
const spec = (
  type: ChartType,
  encodings: ChartSpec['encodings'],
  extra: Partial<ChartSpec> = {},
): ChartSpec =>
  ({
    type,
    data: { savedViewId: '019a2b3c-4d5e-7f00-8a00-000000000003' },
    encodings,
    options: {},
    layout,
    ...extra,
  }) as ChartSpec;

const rows = [
  { id: 'P1', g: 'DMSO', h: 'A', run: 'r1', a: 1, b: 10, c: 2, d: 0.01, cond: 'DMSO' },
  { id: 'P2', g: 'DMSO', h: 'B', run: 'r2', a: 2, b: 20, c: 3, d: 0.2, cond: 'DMSO' },
  { id: 'P3', g: 'CPD', h: 'A', run: 'r1', a: 3, b: 35, c: 5, d: 0.001, cond: 'CPD' },
  { id: 'P4', g: 'CPD', h: 'B', run: 'r2', a: 4, b: 38, c: 7, d: 0.5, cond: 'CPD' },
  { id: 'P5', g: 'CPD', h: 'A', run: 'r3', a: 5, b: 50, c: 11, d: 0.03, cond: 'CPD' },
  { id: 'P6', g: 'DMSO', h: 'B', run: 'r3', a: 6, b: 59, c: 13, d: 0.9, cond: 'DMSO' },
];

/** Deterministic stand-in for apps/compute (its statistics are tested in pytest). */
const calls: { path: string; body: Json }[] = [];
const compute: Compute = {
  cluster: async () => {
    throw new Error('not used');
  },
  kde: async (body) => {
    calls.push({ path: 'kde', body });
    const v = body.values as number[];
    return {
      x: [Math.min(...v), Math.max(...v)],
      density: [0.5, 0.5],
      bandwidth: 1,
      compute_version: 'test',
    };
  },
  groupTest: async (body) => {
    calls.push({ path: 'group-test', body });
    const groups = body.groups as { name: string }[];
    const pairwise = ['welch_t', 'mann_whitney', 'ks'].includes(body.method as string);
    return {
      method: body.method as string,
      overall_p: pairwise ? null : 0.004,
      comparisons: pairwise
        ? groups.slice(1).map((g) => ({ group: g.name, reference: groups[0]!.name, p: 0.02, p_adj: 0.04 }))
        : [],
      adj_method: 'BH',
      compute_version: 'test',
    };
  },
  groupSummary: async (body) => {
    calls.push({ path: 'group-summary', body });
    return {
      groups: (body.groups as { name: string; values: number[] }[]).map((g) => {
        const n = g.values.length;
        const mean = g.values.reduce((s, v) => s + v, 0) / n;
        const sd = n > 1 ? Math.sqrt(g.values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
        return {
          name: g.name,
          n,
          mean,
          sd,
          sem: sd === null ? null : sd / Math.sqrt(n),
          ci95: sd === null ? null : 2 * sd,
          median: mean,
          cv: sd === null || mean === 0 ? null : sd / mean,
        };
      }),
      compute_version: 'test',
    };
  },
  pca: async (body) => {
    calls.push({ path: 'pca', body });
    const n = (body.values as number[][]).length;
    const k = body.components as number;
    return {
      scores: [...Array(n).keys()].map((i) => [...Array(k).keys()].map((j) => i * (j + 1))),
      loadings: [],
      explained_variance_ratio: [...Array(k).keys()].map((j) => 0.5 / (j + 1)),
      compute_version: 'test',
    };
  },
};

const shape = (
  type: ChartType,
  encodings: ChartSpec['encodings'],
  options: Record<string, unknown> = {},
  data = rows,
) =>
  shapeChart(
    type,
    data,
    spec(type, encodings),
    { ...chartDefaults(type), ...options },
    compute,
  ) as Promise<Json>;
const ys = (s: Json) => s.data.flatMap((t: Json) => t.y ?? []);
const xs = (s: Json) => s.data.flatMap((t: Json) => t.x ?? []);

describe('every option changes the output — remaining v1 charts', () => {
  it('VIZ-05: line', async () => {
    const enc = { x: 'a', y: 'b' };
    const base = await shape('line', enc);
    expect(base.data[0].mode).toBe('lines+markers');
    expect(ys(await shape('line', enc, { smoothing: 'moving_average', window: 3 }))).not.toEqual(ys(base));
    expect((await shape('line', { ...enc, label: 'id' }, { point_label: true })).data[0].mode).toContain(
      'text',
    );
    expect(xs(await shape('line', enc, { pseudolog_x: true }))).not.toEqual(xs(base));
    expect(ys(await shape('line', enc, { pseudolog_y: true, pseudolog_base: 2 }))).not.toEqual(
      ys(await shape('line', enc, { pseudolog_y: true })),
    );
    expect(ys(await shape('line', enc, { standardize: 'y' }))).not.toEqual(ys(base));
    expect((await shape('line', { ...enc, color: 'g' })).data).toHaveLength(2);
  });

  it('VIZ-05: bar', async () => {
    const enc = { x: 'g', y: 'b' };
    const base = await shape('bar', enc);
    expect(base.data[0]).toMatchObject({ type: 'bar', x: ['DMSO', 'CPD'] });
    expect(base.data[0].y[0]).toBeCloseTo((10 + 20 + 59) / 3);
    expect((await shape('bar', enc, { aggregate: 'sum' })).data[0].y[0]).toBe(89);
    expect((await shape('bar', enc, { aggregate: 'count' })).data[0].y).toEqual([3, 3]);
    expect((await shape('bar', enc, { aggregate: 'median' })).data[0].y[0]).toBe(20);
    expect((await shape('bar', enc, { orientation: 'h' })).data[0]).toMatchObject({
      orientation: 'h',
      y: ['DMSO', 'CPD'],
    });
    expect((await shape('bar', enc, { error_bars: 'sd' })).data[0].error_y.array[0]).toBeGreaterThan(0);
    expect((await shape('bar', enc, { error_bars: 'sem' })).data[0].error_y.array[0]).toBeLessThan(
      (await shape('bar', enc, { error_bars: 'sd' })).data[0].error_y.array[0],
    );
    expect((await shape('bar', enc, { error_bars: 'ci95' })).data[0].error_y.array[0]).toBeGreaterThan(0);
    expect((await shape('bar', enc, { point_label: true })).data[0].text).toHaveLength(2);
    expect(JSON.stringify((await shape('bar', enc, { p_values: 'welch_t' })).layout.annotations)).toContain(
      'p_adj',
    );
    expect(JSON.stringify((await shape('bar', enc, { p_values: 'anova' })).layout.annotations)).toContain(
      'ANOVA',
    );
    expect(ys(await shape('bar', enc, { pseudolog_y: true }))).not.toEqual(ys(base));
    expect(ys(await shape('bar', enc, { standardize: 'y' }))).not.toEqual(ys(base));
  });

  it('VIZ-05: scatter 2D and 3D', async () => {
    const enc = { x: 'a', y: 'b' };
    const base = await shape('scatter2d', enc);
    expect(base.data[0].type).toBe('scattergl');
    expect((await shape('scatter2d', enc, { webgl: false })).data[0].type).toBe('scatter');
    expect(xs(await shape('scatter2d', enc, { standardize: 'x' }))).not.toEqual(xs(base));
    expect(ys(await shape('scatter2d', enc, { standardize: 'both' }))).not.toEqual(ys(base));
    expect(ys(await shape('scatter2d', enc, { pseudolog_y: true }))).not.toEqual(ys(base));
    expect(
      (await shape('scatter2d', { ...enc, label: 'id' }, { point_label: true })).data[0].text,
    ).toHaveLength(6);
    expect((await shape('scatter2d', { ...enc, color: 'g', shape: 'h' })).data.length).toBe(2);
    const three = await shape('scatter3d', { x: 'a', y: 'b', z: 'c' });
    expect(three.data[0].type).toBe('scatter3d');
    expect(
      (await shape('scatter3d', { x: 'a', y: 'b', z: 'c' }, { pseudolog_z: true })).data[0].z,
    ).not.toEqual(three.data[0].z);
    expect(
      (await shape('scatter3d', { x: 'a', y: 'b', z: 'c' }, { standardize: 'all' })).data[0].x,
    ).not.toEqual(three.data[0].x);
  });

  it('VIZ-05: box / violin', async () => {
    const enc = { x: 'g', y: 'b' };
    expect((await shape('box_violin', enc)).data[0].type).toBe('box');
    expect((await shape('box_violin', enc, { kind: 'violin' })).data[0].type).toBe('violin');
    expect((await shape('box_violin', enc, { kind: 'both' })).data[0]).toMatchObject({
      type: 'violin',
      box: { visible: true },
    });
    expect((await shape('box_violin', enc, { points: 'all' })).data[0].boxpoints).toBe('all');
    expect((await shape('box_violin', enc, { orientation: 'h' })).data[0].orientation).toBe('h');
    expect(
      JSON.stringify((await shape('box_violin', enc, { p_values: 'kruskal' })).layout.annotations),
    ).toContain('Kruskal');
  });

  it('VIZ-05: histogram / KDE', async () => {
    const enc = { x: 'b', color: 'g' };
    const base = await shape('histogram_kde', enc);
    expect(base.data.every((t: Json) => t.type === 'histogram')).toBe(true);
    expect(
      (await shape('histogram_kde', enc, { kind: 'kde' })).data.every((t: Json) => t.type === 'scatter'),
    ).toBe(true);
    const both = await shape('histogram_kde', enc, { kind: 'both' });
    expect(both.data.map((t: Json) => t.type).sort()).toEqual([
      'histogram',
      'histogram',
      'scatter',
      'scatter',
    ]);
    expect(both.data.find((t: Json) => t.type === 'histogram').histnorm).toBe('probability density');
    expect((await shape('histogram_kde', enc, { bins: 7 })).data[0].nbinsx).toBe(7);
    expect((await shape('histogram_kde', enc, { stats: true })).layout.shapes.length).toBeGreaterThan(0);
    expect(
      JSON.stringify((await shape('histogram_kde', enc, { p_values: 'ks' })).layout.annotations),
    ).toContain('p_adj');
    expect(xs(await shape('histogram_kde', enc, { pseudolog_x: true }))).not.toEqual(xs(base));
  });

  it('VIZ-05: lollipop', async () => {
    const enc = { rowLabel: 'id', x: 'b' };
    const base = await shape('lollipop', enc);
    const dots = (s: Json) => s.data.find((t: Json) => t.mode === 'markers');
    expect(dots(base).y).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect(dots(await shape('lollipop', enc, { sort: 'desc' })).y[0]).toBe('P6');
    expect(dots(await shape('lollipop', enc, { sort: 'asc' })).y[0]).toBe('P1');
    expect(dots(await shape('lollipop', enc, { orientation: 'v' })).x).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
    ]);
    expect(dots(await shape('lollipop', enc, { standardize: 'x' })).x).not.toEqual(dots(base).x);
    expect(dots(await shape('lollipop', enc, { pseudolog_x: true })).x).not.toEqual(dots(base).x);
    expect(dots(await shape('lollipop', { ...enc, size: 'c' })).marker.size).toHaveLength(6);
  });

  it('VIZ-05: bubble', async () => {
    const enc = { x: 'a', y: 'b', size: 'c' };
    const sizes = (s: Json) => s.data[0].marker.size as number[];
    const base = await shape('bubble', enc);
    expect(Math.min(...sizes(base))).toBeCloseTo(4);
    expect(Math.max(...sizes(base))).toBeCloseTo(40);
    expect(Math.max(...sizes(await shape('bubble', enc, { size_max: 20 })))).toBeCloseTo(20);
    expect(Math.min(...sizes(await shape('bubble', enc, { size_min: 10 })))).toBeCloseTo(10);
    expect(ys(await shape('bubble', enc, { standardize: 'y' }))).not.toEqual(ys(base));
  });

  it('VIZ-05: pie / donut', async () => {
    const enc = { categories: 'g', values: 'b' };
    const base = await shape('pie_donut', enc);
    expect(base.data[0]).toMatchObject({ type: 'pie', labels: ['DMSO', 'CPD'], values: [89, 123], hole: 0 });
    expect((await shape('pie_donut', enc, { hole: 0.4 })).data[0].hole).toBe(0.4);
    expect((await shape('pie_donut', enc, { textinfo: 'label+percent' })).data[0].textinfo).toBe(
      'label+percent',
    );
    expect((await shape('pie_donut', enc, { textposition: 'outside' })).data[0].textposition).toBe('outside');
    expect((await shape('pie_donut', enc, { direction: 'clockwise' })).data[0].direction).toBe('clockwise');
    expect((await shape('pie_donut', enc, { rotation: 90 })).data[0].rotation).toBe(90);
    expect((await shape('pie_donut', enc, { sort: false })).data[0].sort).toBe(false);
    expect((await shape('pie_donut', enc, { pull: 0.2 })).data[0].pull).toBe(0.2);
    expect((await shape('pie_donut', enc, { pseudolog_values: true })).data[0].values).not.toEqual([89, 123]);
  });
});

describe('MA plot, PCA and QC panel', () => {
  it('VIZ-07: MA plot — hits by |M| and adjusted p, labels', async () => {
    const enc = { x: 'b', y: 'a', z: 'd', label: 'id' };
    const base = await shape('ma', enc, { fc_threshold: 3 });
    expect(base.data.map((t: Json) => t.name)).toEqual(['Up (2)', 'Down (0)', 'Not significant (4)']);
    expect((await shape('ma', enc, { fc_threshold: 3, p_threshold: 0.5 })).data[0].name).toBe('Up (3)');
    expect((await shape('ma', { x: 'b', y: 'a' }, { fc_threshold: 3 })).data[0].name).toBe('Up (4)');
    expect((await shape('ma', enc, { fc_threshold: 3, label_top: 1 })).layout.annotations).toHaveLength(1);
    expect((await shape('ma', enc, { webgl: false })).data[0].type).toBe('scatter');
  });

  it('VIZ-07: PCA — scores with variance explained; chosen components; scale reaches compute', async () => {
    calls.length = 0;
    const enc = { rowLabel: 'id', values: ['a', 'b', 'c'], color: 'g' };
    const base = await shape('pca', enc);
    expect(base.layout.xaxis.title.text).toBe('PC1 (50.0%)');
    expect(base.layout.yaxis.title.text).toBe('PC2 (25.0%)');
    expect(base.data).toHaveLength(2);
    const pc3 = await shape('pca', enc, { components: 3, pc_y: 3 });
    expect(pc3.layout.yaxis.title.text).toBe('PC3 (16.7%)');
    await shape('pca', enc, { scale: true });
    expect(calls.filter((c) => c.path === 'pca').map((c) => c.body.scale)).toEqual([false, false, true]);
    // Long data: rows of one sample pivot to one observation; features with missing values are dropped and reported.
    const longRows = ['r1', 'r2', 'r3'].flatMap((run, i) =>
      ['F1', 'F2', 'F3'].flatMap((f, j) =>
        f === 'F3' && run !== 'r1' ? [] : [{ run, f, v: i * 3 + j + 1 }],
      ),
    );
    const long = await shape('pca', { rowLabel: 'run', x: 'f', values: 'v' }, {}, longRows);
    expect(long.transformations.join(' ')).toMatch(/1 feature\(s\) with missing values left out/);
    expect(calls.at(-1)!.body.values).toEqual([
      [1, 2],
      [4, 5],
      [7, 8],
    ]);
  });

  it('VIZ-08: QC panel — IDs per run, completeness, CVs, intensity distributions; panels toggle', async () => {
    const enc = { x: 'run', rowLabel: 'id', values: 'b', color: 'cond' };
    const base = await shape('qc_panel', enc);
    const names = (s: Json) => s.data.map((t: Json) => t.name);
    expect(names(base)).toEqual(
      expect.arrayContaining(['IDs per run', 'Missing values (%)', 'CV (%)', 'log2 intensity']),
    );
    const ids = base.data.find((t: Json) => t.name === 'IDs per run');
    expect(ids.x).toEqual(['r1', 'r2', 'r3']);
    expect(ids.y).toEqual([2, 2, 2]);
    expect(names(await shape('qc_panel', enc, { show_cv: false }))).not.toContain('CV (%)');
    expect(names(await shape('qc_panel', enc, { show_ids: false, show_completeness: false }))).toEqual([
      'CV (%)',
      'log2 intensity',
    ]);
    const raw = await shape('qc_panel', enc, { log2: false });
    expect(raw.data.find((t: Json) => t.name === 'intensity').y).toContain(59);
  });
});

describe('REFERENCE_V1 §8 — every v1 defect has a named test (data part)', () => {
  it('VIZ-06: KDE after filtering to one value per group is a field error (not "dataset should have multiple elements")', async () => {
    const one = rows.slice(0, 2).map((r, i) => ({ ...r, g: `G${i}` }));
    await expect(shape('histogram_kde', { x: 'b', color: 'g' }, { kind: 'kde' }, one)).rejects.toMatchObject({
      body: { code: 'too_few_values', field: 'encodings.x' },
    });
  });

  it('VIZ-06: more than 24 panels is a field error with the count (not a layout crash)', async () => {
    const many = [...Array(30).keys()].map((i) => ({ ...rows[0]!, id: `P${i}`, h: `panel ${i}` }));
    await expect(shape('scatter2d', { x: 'a', y: 'b', panel: 'h' }, {}, many)).rejects.toMatchObject({
      body: { code: 'too_many_facets', field: 'encodings.panel', message: expect.stringContaining('30') },
    });
    const faceted = await shape('scatter2d', { x: 'a', y: 'b', panel: 'h' });
    expect(faceted.layout.grid).toMatchObject({ rows: 1, columns: 2 });
    expect(faceted.data.map((t: Json) => t.xaxis)).toEqual(['x', 'x2']);
  });

  it('VIZ-06: lollipop rows with null values are dropped and counted (not "NULL values in dataframe")', async () => {
    const holes = rows.map((r, i) => (i < 2 ? { ...r, b: null } : r));
    const s = await shape('lollipop', { rowLabel: 'id', x: 'b' }, {}, holes);
    expect(s.dropped).toBe(2);
    expect(s.rows).toBe(4);
  });

  it('VIZ-06: bubble pseudolog renders and changes the output (v1: always failed)', async () => {
    const enc = { x: 'a', y: 'b', size: 'c' };
    expect(xs(await shape('bubble', enc, { pseudolog_x: true, pseudolog_base: 2 }))).not.toEqual(
      xs(await shape('bubble', enc)),
    );
  });

  it('VIZ-06: pie with negative values is a field error (not a blank chart)', async () => {
    await expect(
      shape('pie_donut', { categories: 'g', values: 'b' }, {}, [...rows, { ...rows[0]!, b: -5 }]),
    ).rejects.toMatchObject({
      body: { code: 'negative_values', field: 'encodings.values' },
    });
  });

  it('VIZ-06: heatmap + dendrogram works for rows only, columns only and both (v1: only both)', async () => {
    const clusterCompute: Compute = {
      ...compute,
      cluster: async (body) => {
        const n = (body.values as number[][]).length;
        const m = (body.values as number[][])[0]!.length;
        const tree = (k: number) => ({
          order: [...Array(k).keys()],
          linkage: [...Array(k - 1).keys()].map((i) => [i === 0 ? 0 : k + i - 1, i + 1, i + 1, i + 2]),
          support: null,
          bootstrap_valid: null,
        });
        return {
          rows: body.axis === 'columns' ? null : tree(n),
          columns: body.axis === 'rows' ? null : tree(m),
          seed: 1,
          method: 'average',
          metric: 'euclidean',
          compute_version: 'test',
        };
      },
    };
    for (const [cluster_rows, cluster_columns] of [
      [true, false],
      [false, true],
      [true, true],
    ])
      await expect(
        shapeChart(
          'heatmap',
          rows,
          spec('heatmap', { values: ['a', 'b', 'c'], rowLabel: 'id' }),
          { ...chartDefaults('heatmap'), cluster_rows, cluster_columns, dendrograms: true },
          clusterCompute,
        ),
      ).resolves.toBeDefined();
  });
});
