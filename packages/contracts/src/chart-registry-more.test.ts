import { describe, expect, it } from 'vitest';
import {
  CHART_REGISTRY,
  CHART_TYPES,
  chartDefaults,
  validateChartSpec,
  type ChartSpec,
  type ColumnType,
} from './index.ts';

const layout = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};
const data = { source: { kind: 'protein_quant' as const, scope: {} } };
const columns: Record<string, ColumnType> = {
  a: 'double',
  b: 'double',
  c: 'double',
  n: 'integer',
  t: 'date',
  g: 'text',
  h: 'text',
  id: 'text',
};
const spec = (
  type: ChartSpec['type'],
  encodings: ChartSpec['encodings'],
  options: Record<string, unknown> = {},
) => ({ type, data, encodings, options, layout }) as ChartSpec;
const errors = (s: ChartSpec) => validateChartSpec(s, columns).map((e) => `${e.field}:${e.code}`);

/** Minimal valid encodings per chart. */
const BASE: Partial<Record<ChartSpec['type'], ChartSpec['encodings']>> = {
  line: { x: 'a', y: 'b' },
  bar: { x: 'g', y: 'a' },
  scatter2d: { x: 'a', y: 'b' },
  scatter3d: { x: 'a', y: 'b', z: 'c' },
  box_violin: { x: 'g', y: 'a' },
  histogram_kde: { x: 'a' },
  lollipop: { rowLabel: 'id', x: 'a' },
  bubble: { x: 'a', y: 'b', size: 'c' },
  pie_donut: { categories: 'g', values: 'a' },
  ma: { x: 'a', y: 'b' },
  pca: { rowLabel: 'id', values: ['a', 'b', 'c'] },
  qc_panel: { x: 'g', rowLabel: 'id', values: 'a' },
};
const check = (
  type: ChartSpec['type'],
  options: Record<string, unknown>,
  encodings: ChartSpec['encodings'] = {},
) => errors(spec(type, { ...BASE[type], ...encodings }, options));

describe('chart registry — remaining v1 charts and omics presets', () => {
  it('VIZ-05: every chart type is registered with valid defaults and minimal encodings', () => {
    expect(Object.keys(CHART_REGISTRY).sort()).toEqual(
      [...CHART_TYPES].filter((t) => t !== 'dose_response').sort(),
    );
    for (const type of Object.keys(BASE) as ChartSpec['type'][]) {
      expect(CHART_REGISTRY[type]!.options.safeParse(chartDefaults(type)).success, type).toBe(true);
      expect(check(type, {}), type).toEqual([]);
    }
  });

  it('VIZ-05: line — smoothing window, point labels, pseudolog, standardisation', () => {
    expect(check('line', { smoothing: 'moving_average', window: 3 })).toEqual([]);
    expect(check('line', { window: 3 })).toEqual(['options.window:requires']);
    expect(check('line', { smoothing: 'moving_average', window: 1 })).toEqual(['options.window:too_small']);
    expect(check('line', { point_label: true })).toEqual(['options.point_label:requires']);
    expect(check('line', { point_label: true }, { label: 'id' })).toEqual([]);
    expect(check('line', {}, { x: 't' })).toEqual([]);
    expect(check('line', { standardize: 'y', pseudolog_y: true })).toEqual(['options.pseudolog_y:conflict']);
  });

  it('VIZ-05: bar — aggregate, error bars, p-values, orientation', () => {
    expect(check('bar', { error_bars: 'sem' })).toEqual([]);
    expect(check('bar', { error_bars: 'sd', aggregate: 'sum' })).toEqual(['options.error_bars:requires']);
    expect(check('bar', { p_values: 'welch_t' })).toEqual([]);
    expect(check('bar', { p_values: 'welch_t', aggregate: 'count' })).toEqual(['options.p_values:requires']);
    expect(check('bar', { orientation: 'h', point_label: true })).toEqual([]);
    expect(check('bar', {}, { x: 'a' })).toEqual(['encodings.x:wrong_type']);
  });

  it('VIZ-05: scatter 2D/3D, bubble — standardisation, pseudolog, bubble sizes', () => {
    expect(check('scatter2d', { standardize: 'both', webgl: false })).toEqual([]);
    expect(check('scatter2d', {}, { x: 'g' })).toEqual([]);
    expect(check('scatter3d', { pseudolog_z: true, pseudolog_base: 2 })).toEqual([]);
    expect(check('scatter3d', {}, { z: 'g' })).toEqual(['encodings.z:wrong_type']);
    expect(check('bubble', { size_min: 10, size_max: 5 })).toEqual(['options.size_max:range']);
    expect(check('bubble', { size_max: 101 })).toEqual(['options.size_max:too_big']);
    expect(check('bubble', { pseudolog_x: true })).toEqual([]);
  });

  it('VIZ-05: box/violin, histogram/KDE, lollipop, pie/donut options', () => {
    expect(
      check('box_violin', { kind: 'both', points: 'all', orientation: 'h', p_values: 'kruskal' }),
    ).toEqual([]);
    expect(check('histogram_kde', { kind: 'kde', bins: 20 })).toEqual(['options.bins:conflict']);
    expect(check('histogram_kde', { kind: 'both', bins: 20, stats: true })).toEqual([]);
    expect(check('histogram_kde', { bins: 0 })).toEqual(['options.bins:too_small']);
    expect(check('lollipop', { orientation: 'v', sort: 'desc', standardize: 'x' })).toEqual([]);
    expect(
      check('pie_donut', {
        hole: 0.5,
        textinfo: 'label+percent',
        direction: 'counterclockwise',
        rotation: 90,
        pull: 0.1,
      }),
    ).toEqual([]);
    expect(check('pie_donut', { hole: 0.95 })).toEqual(['options.hole:too_big']);
    expect(check('pie_donut', { rotation: 400 })).toEqual(['options.rotation:too_big']);
  });

  it('VIZ-07: MA plot and PCA options', () => {
    expect(check('ma', { label_top: 5 }, { label: 'id', z: 'c' })).toEqual([]);
    expect(check('ma', { label_top: 5 }, { z: 'c' })).toEqual(['options.label_top:requires']);
    expect(check('ma', { p_threshold: 0 })).toEqual(['options.p_threshold:too_small']);
    expect(check('pca', { components: 3, pc_x: 1, pc_y: 3, scale: true })).toEqual([]);
    expect(check('pca', { pc_x: 2, pc_y: 2 })).toEqual(['options.pc_y:conflict']);
    expect(check('pca', { components: 2, pc_y: 3 })).toEqual(['options.pc_y:range']);
    expect(check('pca', {}, { x: 'g', values: 'a' })).toEqual([]);
    expect(check('pca', {}, { x: 'g' })).toEqual(['encodings.values:single']);
  });

  it('VIZ-08: QC panel options', () => {
    expect(check('qc_panel', { log2: false, show_cv: false }, { color: 'h' })).toEqual([]);
    expect(
      check('qc_panel', { show_ids: false, show_completeness: false, show_cv: false, show_intensity: false }),
    ).toEqual(['options.show_ids:requires']);
    expect(check('qc_panel', {}, { values: 'g' })).toEqual(['encodings.values:wrong_type']);
  });
});

describe('REFERENCE_V1 §8 — every v1 defect has a named test (registry part)', () => {
  it('VIZ-06: p-value calculation without a group column is a field error, not a server error', () => {
    expect(check('histogram_kde', { p_values: 'kruskal' })).toEqual(['options.p_values:requires']);
    expect(check('histogram_kde', { p_values: 'kruskal' }, { color: 'g' })).toEqual([]);
  });

  it('VIZ-06: required x/y columns are field errors (Apply stays disabled)', () => {
    expect(errors(spec('scatter2d', {}))).toEqual(['encodings.x:required', 'encodings.y:required']);
    expect(errors(spec('bar', { x: 'g' }))).toEqual(['encodings.y:required']);
  });

  it('VIZ-06: lollipop size accepts only numeric columns', () => {
    expect(check('lollipop', {}, { size: 'g' })).toEqual(['encodings.size:wrong_type']);
    expect(check('lollipop', {}, { size: 'n' })).toEqual([]);
  });

  it('VIZ-06: pseudolog base is a typed number in 2–10 on every chart that offers it', () => {
    for (const type of [
      'line',
      'bar',
      'scatter2d',
      'scatter3d',
      'histogram_kde',
      'lollipop',
      'bubble',
      'pie_donut',
    ] as const) {
      expect(check(type, { pseudolog_base: 11 }), type).toEqual(['options.pseudolog_base:too_big']);
      expect(check(type, { pseudolog_base: '5' }), type).toEqual(['options.pseudolog_base:invalid_type']);
    }
  });

  it('VIZ-06: no dead options — lollipop has no "query" option; unknown options are rejected', () => {
    expect(check('lollipop', { query: 'x' })).toEqual(['options.query:unknown_option']);
  });

  it('VIZ-06: facets are capped at 24 panels (declared per chart)', () => {
    for (const type of [
      'line',
      'bar',
      'scatter2d',
      'box_violin',
      'histogram_kde',
      'lollipop',
      'bubble',
      'pie_donut',
    ] as const)
      expect(CHART_REGISTRY[type]!.dataRules.maxFacets, type).toBe(24);
  });
});

describe('omics review rules (Phase 15)', () => {
  it('VIZ-05: error bars need a linear y axis; pooled p-values are refused; pie percentages of pseudolog values', () => {
    expect(check('bar', { error_bars: 'sd', pseudolog_y: true })).toEqual(['options.pseudolog_y:conflict']);
    expect(check('bar', { p_values: 'welch_t' }, { color: 'h' })).toEqual(['options.p_values:conflict']);
    expect(check('box_violin', { p_values: 'kruskal' }, { panel: 'h' })).toEqual([
      'options.p_values:conflict',
    ]);
    expect(check('histogram_kde', { p_values: 'kruskal' }, { color: 'g', panel: 'h' })).toEqual([
      'options.p_values:conflict',
    ]);
    expect(check('pie_donut', { pseudolog_values: true })).toEqual(['options.pseudolog_values:conflict']);
    expect(check('pie_donut', { pseudolog_values: true, textinfo: 'value' })).toEqual([]);
    expect(check('line', { smoothing: 'moving_average', window: 4 })).toEqual(['options.window:range']);
  });
});
