import { describe, expect, it } from 'vitest';
import {
  CHART_REGISTRY,
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
const data = { source: { kind: 'differential_abundance' as const, scope: {} } };
const columns: Record<string, ColumnType> = {
  log2_fc: 'double',
  adj_p_value: 'double',
  p_value: 'double',
  feature_id: 'text',
  contrast_label: 'text',
  gene_names: 'text[]',
  n_obs_num: 'integer',
  s1: 'double',
  s2: 'double',
  s3: 'double',
};
const spec = (
  type: ChartSpec['type'],
  encodings: ChartSpec['encodings'],
  options: Record<string, unknown> = {},
) => ({ type, data, encodings, options, layout }) as ChartSpec;
const errors = (s: ChartSpec, cols = columns) =>
  validateChartSpec(s, cols).map((e) => `${e.field}:${e.code}`);

const volcano = (options: Record<string, unknown> = {}, encodings: ChartSpec['encodings'] = {}) =>
  spec('volcano', { x: 'log2_fc', y: 'adj_p_value', ...encodings }, options);
const heatmap = (options: Record<string, unknown> = {}) =>
  spec('heatmap', { values: ['s1', 's2', 's3'], rowLabel: 'feature_id' }, options);
const dendrogram = (options: Record<string, unknown> = {}) =>
  spec('dendrogram', { values: ['s1', 's2', 's3'], rowLabel: 'feature_id' }, options);

describe('chart registry (Phase 14 reference charts)', () => {
  it('VIZ-01: defaults of every chart are valid and complete', () => {
    for (const type of ['volcano', 'heatmap', 'dendrogram'] as const) {
      const defaults = chartDefaults(type);
      expect(CHART_REGISTRY[type]!.options.safeParse(defaults).success).toBe(true);
    }
    expect(chartDefaults('volcano')).toMatchObject({
      fc_threshold: 1,
      p_threshold: 0.05,
      y_transform: 'neg_log10',
    });
    expect(errors(volcano())).toEqual([]);
    expect(errors(heatmap())).toEqual([]);
    expect(errors(dendrogram())).toEqual([]);
  });

  it('VIZ-01: required encodings, type-aware slots and unknown columns are field errors', () => {
    expect(errors(spec('volcano', { x: 'log2_fc' }))).toEqual(['encodings.y:required']);
    expect(errors(volcano({}, { x: 'feature_id' }))).toEqual(['encodings.x:wrong_type']);
    expect(errors(volcano({}, { color: 'not_a_column' }))).toEqual(['encodings.color:unknown_column']);
    expect(errors(volcano({}, { label: 'gene_names' }))).toEqual([]);
    expect(errors(spec('heatmap', { values: ['s1', 'feature_id'], rowLabel: 'feature_id' }))).toEqual([
      'encodings.values:wrong_type',
    ]);
    expect(errors(spec('heatmap', { values: 's1', rowLabel: 'feature_id' }))).toEqual([]);
    expect(errors(spec('dendrogram', { rowLabel: 'feature_id' }))).toEqual(['encodings.values:required']);
    expect(errors(volcano({}, { shape: 'feature_id' }))).toEqual(['encodings.shape:not_supported']);
  });

  it('VIZ-01: volcano options — ranges and requires rules', () => {
    expect(errors(volcano({ fc_threshold: -1 }))).toEqual(['options.fc_threshold:too_small']);
    expect(errors(volcano({ p_threshold: 0 }))).toEqual(['options.p_threshold:too_small']);
    expect(errors(volcano({ p_threshold: 1.5 }))).toEqual(['options.p_threshold:too_big']);
    expect(errors(volcano({ y_transform: 'log' }))).toEqual(['options.y_transform:invalid_value']);
    expect(errors(volcano({ label_top: 500 }))).toEqual(['options.label_top:too_big']);
    // Labelling hits needs a label column.
    expect(errors(volcano({ label_top: 10 }))).toEqual(['options.label_top:requires']);
    expect(errors(volcano({ label_top: 10 }, { label: 'feature_id' }))).toEqual([]);
    // Pseudolog base is 2–10 and needs a pseudolog axis; pseudolog Y conflicts with −log10.
    expect(errors(volcano({ pseudolog_base: 1 }))).toEqual(['options.pseudolog_base:too_small']);
    expect(errors(volcano({ pseudolog_base: 11 }))).toEqual(['options.pseudolog_base:too_big']);
    expect(errors(volcano({ pseudolog_base: 2 }))).toEqual(['options.pseudolog_base:requires']);
    expect(errors(volcano({ pseudolog_x: true, pseudolog_base: 2 }))).toEqual([]);
    expect(errors(volcano({ pseudolog_y: true }))).toEqual(['options.pseudolog_y:conflict']);
    expect(errors(volcano({ pseudolog_y: true, y_transform: 'none' }))).toEqual([]);
    expect(errors(volcano({ standardize_x: true, fc_threshold: 1 }))).toEqual([
      'options.fc_threshold:conflict',
    ]);
    expect(errors(volcano({ standardize_x: true, fc_threshold: 0 }))).toEqual([]);
    expect(errors(volcano({ webgl: false }))).toEqual([]);
    expect(errors(volcano({ unknown: 1 }))).toEqual(['options.unknown:unknown_option']);
  });

  it('VIZ-01: heatmap options — every clustering combination is valid; requires rules', () => {
    for (const cluster_rows of [true, false])
      for (const cluster_columns of [true, false])
        for (const dendrograms of [true, false]) {
          const expected =
            dendrograms && !cluster_rows && !cluster_columns ? ['options.dendrograms:requires'] : [];
          expect(errors(heatmap({ cluster_rows, cluster_columns, dendrograms }))).toEqual(expected);
        }
    expect(errors(heatmap({ scale: 'zscore_rows' }))).toEqual([]);
    expect(errors(heatmap({ scale: 'log' }))).toEqual(['options.scale:invalid_value']);
    expect(errors(heatmap({ min: 2, max: 1 }))).toEqual(['options.max:range']);
    expect(errors(heatmap({ min: -2, max: 2, centered: true }))).toEqual([]);
    expect(errors(heatmap({ cluster_rows: true, method: 'ward.D2', metric: 'manhattan' }))).toEqual([
      'options.metric:requires',
    ]);
    expect(errors(heatmap({ cluster_rows: true, method: 'ward.D2', metric: 'euclidean' }))).toEqual([]);
    expect(errors(heatmap({ method: 'average', metric: 'cosine' }))).toEqual([]);
    expect(errors(heatmap({ leaf_ordering: 'optimal' }))).toEqual([]);
  });

  it('VIZ-01: dendrogram options — ranges and requires rules', () => {
    expect(errors(dendrogram({ axis: 'both' }))).toEqual([]);
    expect(errors(dendrogram({ axis: 'diagonal' }))).toEqual(['options.axis:invalid_value']);
    expect(errors(dendrogram({ bootstrap_n: 1001 }))).toEqual(['options.bootstrap_n:too_big']);
    expect(errors(dendrogram({ bootstrap_n: -1 }))).toEqual(['options.bootstrap_n:too_small']);
    expect(errors(dendrogram({ color_threshold: 1 }))).toEqual(['options.color_threshold:requires']);
    expect(errors(dendrogram({ color_scheme: 'cluster', color_threshold: 1 }))).toEqual([]);
    expect(errors(dendrogram({ color_threshold: -1, color_scheme: 'cluster' }))).toEqual([
      'options.color_threshold:too_small',
    ]);
    expect(errors(dendrogram({ method: 'centroid', metric: 'cosine' }))).toEqual(['options.metric:requires']);
    for (const orientation of ['top', 'bottom', 'left', 'right'])
      expect(errors(dendrogram({ orientation }))).toEqual([]);
    expect(errors(dendrogram({ interpolation: 'linear' }))).toEqual([]);
    expect(errors(dendrogram({ attach_heatmap: true, axis: 'columns' }))).toEqual([]);
    expect(errors(dendrogram({ standardize: 'zscore_columns' }))).toEqual([]);
  });

  it('VIZ-01: data rules are declared (null policy, minimum rows, point caps)', () => {
    expect(CHART_REGISTRY.volcano!.dataRules).toMatchObject({ nullPolicy: 'drop-and-report', minRows: 1 });
    expect(CHART_REGISTRY.volcano!.traces).toContain('scattergl');
    expect(CHART_REGISTRY.heatmap!.dataRules.minRows).toBe(2);
    expect(CHART_REGISTRY.dendrogram!.compute).toBe('python');
  });
});
