import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';
import { clusteringShape, euclideanRule, fail, scaleSchema } from './shared.ts';

/** Heatmap with optional row/column clustering and dendrograms (REFERENCE_V1 §7; every combination is valid). */
export const heatmapOptions = z
  .strictObject({
    /** Standardisation before colouring (z-score per row or per column, sample SD). */
    scale: scaleSchema,
    /** Colour range limits (values outside are clamped by the colour scale, not changed). */
    min: z.number().optional(),
    max: z.number().optional(),
    /** Diverging colour scale centred on 0. */
    centered: z.boolean().default(false),
    cluster_rows: z.boolean().default(false),
    cluster_columns: z.boolean().default(false),
    dendrograms: z.boolean().default(false),
    ...clusteringShape,
  })
  .superRefine((o, ctx) => {
    if (o.min !== undefined && o.max !== undefined && o.min >= o.max)
      fail(ctx, 'max', 'range', 'The maximum must be above the minimum.');
    if (o.dendrograms && !o.cluster_rows && !o.cluster_columns)
      fail(ctx, 'dendrograms', 'requires', 'Dendrograms need row or column clustering.');
    euclideanRule(ctx, o);
  });
export type HeatmapOptions = z.infer<typeof heatmapOptions>;

/** Wide (several numeric columns) or long (x = column category + one numeric values column, pivoted). */
export const matrixEncodings: ChartDefinition['encodings'] = {
  values: { required: true, accepts: ['numeric'], multiple: true },
  rowLabel: { required: true, accepts: ['categorical'] },
  x: { required: false, accepts: ['categorical'] },
  hover: { required: false, accepts: ['any'], multiple: true },
};

export const matrixRules: NonNullable<ChartDefinition['rules']> = (spec) => {
  const values = spec.encodings.values;
  return spec.encodings.x && Array.isArray(values) && values.length > 1
    ? [
        {
          code: 'single',
          field: 'encodings.values',
          message: 'With a column category (x), pick one values column.',
        },
      ]
    : [];
};

export const heatmap: ChartDefinition = {
  type: 'heatmap',
  label: 'Heatmap',
  encodings: matrixEncodings,
  options: heatmapOptions,
  rules: matrixRules,
  dataRules: { minRows: 2, maxPoints: 200_000, nullPolicy: 'drop-and-report' },
  compute: 'python',
  traces: ['heatmap', 'scatter'],
};
