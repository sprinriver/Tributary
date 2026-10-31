import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';
import { COMMON, fail, needsEncoding, pooledPValues, pseudologRule, pseudologShape } from './shared.ts';

// Line, bar, scatter 2D/3D and bubble (REFERENCE_V1 §7 options; facets capped at 24, §8).

const pointLabel = needsEncoding(
  'point_label',
  (o) => o.point_label === true,
  'label',
  'Choose a label column for point labels.',
);

export const lineOptions = z
  .strictObject({
    point_label: z.boolean().default(false),
    ...pseudologShape(['x', 'y']),
    smoothing: z.enum(['none', 'moving_average']).default('none'),
    /** Centred moving-average window (points). */
    window: z.int().min(2).max(50).optional(),
    standardize: z.enum(['none', 'y']).default('none'),
  })
  .superRefine((o, ctx) => {
    pseudologRule(ctx, o);
    if (o.window !== undefined && o.smoothing === 'none')
      fail(ctx, 'window', 'requires', 'A window applies to moving-average smoothing.');
    if (o.window !== undefined && o.window % 2 === 0)
      fail(ctx, 'window', 'range', 'Use an odd window (the average is centred on each point).');
    if (o.standardize === 'y' && o.pseudolog_y)
      fail(ctx, 'pseudolog_y', 'conflict', 'Pick z-score or pseudolog for y, not both.');
  });

export const line: ChartDefinition = {
  type: 'line',
  label: 'Line',
  encodings: {
    x: { required: true, accepts: ['numeric', 'temporal'] },
    y: { required: true, accepts: ['numeric'] },
    ...COMMON,
  },
  options: lineOptions,
  rules: pointLabel,
  dataRules: { minRows: 1, maxFacets: 24, maxPoints: 200_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scatter'],
};

export const barOptions = z
  .strictObject({
    orientation: z.enum(['v', 'h']).default('v'),
    aggregate: z.enum(['mean', 'median', 'sum', 'count']).default('mean'),
    error_bars: z.enum(['none', 'sd', 'sem', 'ci95']).default('none'),
    point_label: z.boolean().default(false),
    /** Each bar's group against the first (pairwise, BH) or all groups at once. */
    p_values: z.enum(['none', 'welch_t', 'mann_whitney', 'anova', 'kruskal']).default('none'),
    ...pseudologShape(['y']),
    standardize: z.enum(['none', 'y']).default('none'),
  })
  .superRefine((o, ctx) => {
    pseudologRule(ctx, o);
    if (o.error_bars !== 'none' && o.aggregate !== 'mean')
      fail(ctx, 'error_bars', 'requires', 'Error bars describe a mean: set the aggregate to mean.');
    if (o.p_values !== 'none' && o.aggregate === 'count')
      fail(ctx, 'p_values', 'requires', 'p-values compare values, not counts: pick another aggregate.');
    // Error bars are lengths on a linear axis; on a pseudolog axis they would be drawn at the wrong ends.
    if (o.pseudolog_y && o.error_bars !== 'none')
      fail(
        ctx,
        'pseudolog_y',
        'conflict',
        'Error bars need a linear y axis: turn off pseudolog Y or the error bars.',
      );
  });

export const bar: ChartDefinition = {
  type: 'bar',
  label: 'Bar',
  encodings: {
    x: { required: true, accepts: ['categorical'] },
    y: { required: true, accepts: ['numeric'] },
    color: COMMON.color,
    hover: COMMON.hover,
    panel: COMMON.panel,
  },
  options: barOptions,
  rules: pooledPValues('x groups'),
  dataRules: { minRows: 1, maxFacets: 24, maxPoints: 200_000, nullPolicy: 'drop-and-report' },
  compute: 'python',
  traces: ['bar'],
};

export const scatter2dOptions = z
  .strictObject({
    point_label: z.boolean().default(false),
    ...pseudologShape(['x', 'y']),
    standardize: z.enum(['none', 'x', 'y', 'both']).default('none'),
    webgl: z.boolean().default(true),
  })
  .superRefine((o, ctx) => pseudologRule(ctx, o));

export const scatter2d: ChartDefinition = {
  type: 'scatter2d',
  label: 'Scatter 2D',
  encodings: {
    x: { required: true, accepts: ['numeric', 'categorical'] },
    y: { required: true, accepts: ['numeric'] },
    ...COMMON,
  },
  options: scatter2dOptions,
  rules: pointLabel,
  dataRules: { minRows: 1, maxFacets: 24, maxPoints: 500_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scattergl', 'scatter'],
};

export const scatter3dOptions = z
  .strictObject({ ...pseudologShape(['x', 'y', 'z']), standardize: z.enum(['none', 'all']).default('none') })
  .superRefine((o, ctx) => pseudologRule(ctx, o));

export const scatter3d: ChartDefinition = {
  type: 'scatter3d',
  label: 'Scatter 3D',
  encodings: {
    x: { required: true, accepts: ['numeric'] },
    y: { required: true, accepts: ['numeric'] },
    z: { required: true, accepts: ['numeric'] },
    color: COMMON.color,
    shape: COMMON.shape,
    opacity: COMMON.opacity,
    hover: COMMON.hover,
  },
  options: scatter3dOptions,
  dataRules: { minRows: 1, maxPoints: 200_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scatter3d'],
};

export const bubbleOptions = z
  .strictObject({
    ...pseudologShape(['x', 'y']),
    /** Marker diameters (px) for the smallest and largest size values (linear in between). */
    size_min: z.number().min(1).max(100).default(4),
    size_max: z.number().min(1).max(100).default(40),
    standardize: z.enum(['none', 'x', 'y', 'both']).default('none'),
  })
  .superRefine((o, ctx) => {
    pseudologRule(ctx, o);
    if (o.size_max <= o.size_min)
      fail(ctx, 'size_max', 'range', 'The largest bubble must be bigger than the smallest.');
  });

export const bubble: ChartDefinition = {
  type: 'bubble',
  label: 'Bubble',
  encodings: {
    x: { required: true, accepts: ['numeric'] },
    y: { required: true, accepts: ['numeric'] },
    size: { required: true, accepts: ['numeric'] },
    color: COMMON.color,
    hover: COMMON.hover,
    panel: COMMON.panel,
  },
  options: bubbleOptions,
  dataRules: { minRows: 1, maxFacets: 24, maxPoints: 100_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scatter'],
};
