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
const columns: Record<string, ColumnType> = {
  feature_id: 'text',
  compound_id: 'text',
  log2_fc: 'double',
  adj_p_value: 'double',
};
const spec = (
  type: ChartSpec['type'],
  encodings: ChartSpec['encodings'],
  options: Record<string, unknown> = {},
) =>
  ({ type, data: { source: { kind: 'dose_response', scope: {} } }, encodings, options, layout }) as ChartSpec;
const errors = (s: ChartSpec) => validateChartSpec(s, columns).map((e) => `${e.field}:${e.code}`);

describe('results charts (Phase 16)', () => {
  it('RES-02: dose-response viewer — regulation and FDR filters, small-multiples cap, log dose axis', () => {
    const base = { label: 'feature_id', panel: 'compound_id' };
    expect(CHART_REGISTRY.dose_response!.options.safeParse(chartDefaults('dose_response')).success).toBe(
      true,
    );
    expect(chartDefaults('dose_response')).toMatchObject({
      regulation: ['up', 'down'],
      max_curves: 12,
      show_fit: true,
      log_dose: true,
    });
    expect(errors(spec('dose_response', base))).toEqual([]);
    expect(errors(spec('dose_response', base, { regulation: ['up', 'sideways'] }))).toEqual([
      'options.regulation.1:invalid_value',
    ]);
    expect(errors(spec('dose_response', base, { regulation: [] }))).toEqual(['options.regulation:too_small']);
    expect(errors(spec('dose_response', base, { fdr_max: 0 }))).toEqual(['options.fdr_max:too_small']);
    expect(errors(spec('dose_response', base, { max_curves: 25 }))).toEqual(['options.max_curves:too_big']);
    expect(
      errors(spec('dose_response', base, { sort: 'pec50_desc', show_fit: false, log_dose: false })),
    ).toEqual([]);
    expect(errors(spec('dose_response', {}))).toEqual(['encodings.label:required']);
  });

  it('RES-04: volcano known-target overlay — highlighted ids with a legend label', () => {
    const v = (options: Record<string, unknown>, label = true) =>
      validateChartSpec(
        {
          ...spec(
            'volcano',
            { x: 'log2_fc', y: 'adj_p_value', ...(label ? { label: 'feature_id' } : {}) },
            options,
          ),
          data: { source: { kind: 'differential_abundance', scope: {} } },
        },
        columns,
      ).map((e) => `${e.field}:${e.code}`);
    expect(v({ highlight: ['P31749', 'P00533'], highlight_label: 'CPD-000005 targets' })).toEqual([]);
    // Highlighted ids are matched against the label column (any accession of a protein group).
    expect(v({ highlight: ['P1'] }, false)).toEqual(['options.highlight:requires']);
    expect(v({ highlight: [] })).toEqual([]);
  });
});
