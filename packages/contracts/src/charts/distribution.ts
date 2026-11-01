import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';
import { COMMON, fail, needsEncoding, pooledPValues, pseudologRule, pseudologShape } from './shared.ts';

// Box/violin, histogram/KDE, lollipop and pie/donut (REFERENCE_V1 §7; §8 defects as schema rules).

export const boxViolinOptions = z.strictObject({
  kind: z.enum(['box', 'violin', 'both']).default('box'),
  orientation: z.enum(['v', 'h']).default('v'),
  points: z.enum(['outliers', 'all', 'none']).default('outliers'),
  /** x groups: each against the first (pairwise, BH) or all at once. */
  p_values: z.enum(['none', 'welch_t', 'mann_whitney', 'anova', 'kruskal']).default('none'),
});

export const boxViolin: ChartDefinition = {
  type: 'box_violin',
  label: 'Box / violin',
  encodings: {
    x: { required: true, accepts: ['categorical'] },
    y: { required: true, accepts: ['numeric'] },
    color: COMMON.color,
    hover: COMMON.hover,
    panel: COMMON.panel,
  },
  options: boxViolinOptions,
  rules: pooledPValues('x groups'),
  dataRules: {
    minRows: 1,
    minRowsPerGroup: 1,
    maxFacets: 24,
    maxPoints: 200_000,
    nullPolicy: 'drop-and-report',
  },
  compute: 'python',
  traces: ['box', 'violin'],
};

export const histogramOptions = z
  .strictObject({
    kind: z.enum(['histogram', 'kde', 'both']).default('histogram'),
    /** Number of bins (automatic when empty). */
    bins: z.int().min(1).max(500).optional(),
    /** Mean and median lines per group. */
    stats: z.boolean().default(false),
    /** Colour groups: each against the first (pairwise, BH) or all at once. */
    p_values: z.enum(['none', 'welch_t', 'mann_whitney', 'ks', 'anova', 'kruskal']).default('none'),
    ...pseudologShape(['x']),
  })
  .superRefine((o, ctx) => {
    pseudologRule(ctx, o);
    if (o.bins !== undefined && o.kind === 'kde')
      fail(ctx, 'bins', 'conflict', 'A density curve has no bins.');
  });

export const histogramKde: ChartDefinition = {
  type: 'histogram_kde',
  label: 'Histogram / KDE',
  encodings: {
    x: { required: true, accepts: ['numeric'] },
    color: { required: false, accepts: ['categorical'] },
    panel: COMMON.panel,
  },
  options: histogramOptions,
  // v1: "p-value calculation failed when no group column chosen".
  rules: (spec, options) => [
    ...needsEncoding(
      'p_values',
      (o) => o.p_values !== 'none',
      'color',
      'p-values compare colour groups: choose a colour column.',
    )(spec, options),
    ...pooledPValues('colour groups', ['panel'])(spec, options),
  ],
  dataRules: {
    minRows: 2,
    minRowsPerGroup: 2,
    maxFacets: 24,
    maxPoints: 500_000,
    nullPolicy: 'drop-and-report',
  },
  compute: 'python',
  traces: ['histogram', 'scatter'],
};

export const lollipopOptions = z
  .strictObject({
    orientation: z.enum(['h', 'v']).default('h'),
    sort: z.enum(['none', 'asc', 'desc']).default('none'),
    ...pseudologShape(['x']),
    standardize: z.enum(['none', 'x']).default('none'),
  })
  .superRefine((o, ctx) => pseudologRule(ctx, o));

export const lollipop: ChartDefinition = {
  type: 'lollipop',
  label: 'Lollipop',
  encodings: {
    rowLabel: { required: true, accepts: ['categorical'] },
    x: { required: true, accepts: ['numeric'] },
    color: COMMON.color,
    // v1: "can only concatenate str to int" — size accepts numeric columns only.
    size: { required: false, accepts: ['numeric'] },
    hover: COMMON.hover,
    panel: COMMON.panel,
  },
  options: lollipopOptions,
  dataRules: { minRows: 1, maxFacets: 24, maxPoints: 5_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scatter'],
};

export const pieOptions = z
  .strictObject({
    /** 0 = pie; > 0 = donut hole as a fraction of the radius. */
    hole: z.number().min(0).max(0.9).default(0),
    textinfo: z.enum(['percent', 'label', 'value', 'label+percent', 'none']).default('percent'),
    textposition: z.enum(['auto', 'inside', 'outside']).default('auto'),
    direction: z.enum(['counterclockwise', 'clockwise']).default('counterclockwise'),
    rotation: z.number().min(0).max(360).default(0),
    sort: z.boolean().default(true),
    /** Exploded view: how far slices are pulled out (fraction of the radius). */
    pull: z.number().min(0).max(0.5).default(0),
    pseudolog_values: z.boolean().default(false),
    pseudolog_base: z.number().min(2).max(10).optional(),
  })
  .superRefine((o, ctx) => {
    if (o.pseudolog_base !== undefined && !o.pseudolog_values)
      fail(ctx, 'pseudolog_base', 'requires', 'Turn on pseudolog values for a base to apply.');
    // Shares of pseudologged sums are not shares of the data.
    if (o.pseudolog_values && o.textinfo.includes('percent'))
      fail(
        ctx,
        'pseudolog_values',
        'conflict',
        'Percentages of pseudolog values are meaningless: show labels or values instead.',
      );
  });

export const pieDonut: ChartDefinition = {
  type: 'pie_donut',
  label: 'Pie / donut',
  encodings: {
    categories: { required: true, accepts: ['categorical'] },
    values: { required: true, accepts: ['numeric'] },
    hover: COMMON.hover,
    panel: COMMON.panel,
  },
  options: pieOptions,
  dataRules: { minRows: 1, maxFacets: 24, maxPoints: 100_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['pie'],
};
