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
const columns: Record<string, ColumnType> = { feature_id: 'text', comparison: 'text', delta_tm: 'double' };
const spec = (
  type: ChartSpec['type'],
  encodings: ChartSpec['encodings'],
  options: Record<string, unknown> = {},
) =>
  ({ type, data: { source: { kind: 'thermal_shift', scope: {} } }, encodings, options, layout }) as ChartSpec;
const errors = (s: ChartSpec) => validateChartSpec(s, columns).map((e) => `${e.field}:${e.code}`);

describe('thermal proteome profiling charts (Phase 46)', () => {
  it('TPP-03: melting_curve registry entry — filters, small-multiples cap, order and the fitted curve switch', () => {
    expect(CHART_TYPES).toContain('melting_curve');
    const base = { label: 'feature_id', panel: 'comparison' };
    expect(chartDefaults('melting_curve')).toEqual({
      passed_filter_only: false,
      max_curves: 12,
      sort: 'adj_p_asc',
      show_fit: true,
    });
    expect(errors(spec('melting_curve', base))).toEqual([]);
    expect(errors(spec('melting_curve', base, { adj_p_max: 0 }))).toEqual(['options.adj_p_max:too_small']);
    expect(errors(spec('melting_curve', base, { adj_p_max: 1.5 }))).toEqual(['options.adj_p_max:too_big']);
    expect(errors(spec('melting_curve', base, { max_curves: 25 }))).toEqual(['options.max_curves:too_big']);
    expect(errors(spec('melting_curve', base, { sort: 'random' }))).toEqual(['options.sort:invalid_value']);
    expect(
      errors(
        spec('melting_curve', base, {
          sort: 'abs_delta_tm_desc',
          show_fit: false,
          passed_filter_only: true,
          adj_p_max: 0.05,
        }),
      ),
    ).toEqual([]);
    expect(errors(spec('melting_curve', {}))).toEqual(['encodings.label:required']);
    expect(CHART_REGISTRY.melting_curve!.requiresColumns).toEqual(
      expect.arrayContaining(['temperatures_c', 'fc_treatment', 'fc_vehicle', 'melt_point_treatment']),
    );
  });

  it('TPP-04: thermal_shift registry entry — adjusted p and ΔTm thresholds, labels', () => {
    expect(CHART_TYPES).toContain('thermal_shift');
    const base = { label: 'feature_id', panel: 'comparison' };
    expect(chartDefaults('thermal_shift')).toEqual({ adj_p_max: 0.05, min_abs_delta_tm: 0, label_top: 10 });
    expect(errors(spec('thermal_shift', base))).toEqual([]);
    expect(errors(spec('thermal_shift', base, { adj_p_max: 0 }))).toEqual(['options.adj_p_max:too_small']);
    expect(errors(spec('thermal_shift', base, { min_abs_delta_tm: -1 }))).toEqual([
      'options.min_abs_delta_tm:too_small',
    ]);
    expect(errors(spec('thermal_shift', base, { label_top: 51 }))).toEqual(['options.label_top:too_big']);
    expect(errors(spec('thermal_shift', {}))).toEqual(['encodings.label:required']);
    expect(CHART_REGISTRY.thermal_shift!.requiresColumns).toEqual(
      expect.arrayContaining(['delta_tm', 'adj_p_value', 'fulfills_all_requirements']),
    );
  });
});
