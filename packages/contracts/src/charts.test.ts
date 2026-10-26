import { describe, expect, it } from 'vitest';
import { CHART_REGISTRY, CHART_TYPES, ChartSpecSchema } from './index.ts';

describe('chart spec', () => {
  it('CON-03: covers the 12 v1 chart types plus MA, PCA, dose-response and QC panel', () => {
    expect(CHART_TYPES).toHaveLength(16);
    expect(CHART_TYPES).toContain('volcano');
    expect(CHART_TYPES).toContain('dose_response');
  });

  it('CON-03: the registry starts empty (charts arrive in Phases 14–15)', () => {
    expect(Object.keys(CHART_REGISTRY)).toEqual([]);
  });

  it('CON-03: a ChartSpec wraps a QuerySpec or a saved view', () => {
    const base = {
      type: 'volcano',
      encodings: { x: 'log2_fc', y: 'adj_p_value' },
      options: {},
      layout: {
        palette: 'default',
        gridX: true,
        gridY: true,
        sharedX: false,
        sharedY: false,
        sharedLegend: true,
        subplotLegend: false,
      },
    };
    expect(
      ChartSpecSchema.safeParse({
        ...base,
        data: { source: { kind: 'differential_abundance', scope: {} } },
      }).success,
    ).toBe(true);
    expect(
      ChartSpecSchema.safeParse({ ...base, data: { savedViewId: '019a2b3c-4d5e-7f00-8a00-000000000003' } })
        .success,
    ).toBe(true);
    expect(ChartSpecSchema.safeParse({ ...base, type: 'sankey', data: { savedViewId: 'x' } }).success).toBe(
      false,
    );
  });
});
