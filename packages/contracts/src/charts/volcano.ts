import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';
import { fail } from './shared.ts';

/** Volcano (REFERENCE_V1 §7 + SPEC M7 omics preset): effect size against −log10 p with thresholds. */
export const volcanoOptions = z
  .strictObject({
    /** |x| at or above this is a hit (x in its own units, e.g. log2 fold change). */
    fc_threshold: z.number().min(0).default(1),
    /** p (adjusted, as chosen for y) at or below this is a hit. */
    p_threshold: z.number().gt(0).max(1).default(0.05),
    /** y is a p-value shown as −log10(p), or an already transformed value shown as is. */
    y_transform: z.enum(['neg_log10', 'none']).default('neg_log10'),
    /** Label the N most significant hits (needs a label column). */
    label_top: z.int().min(0).max(100).default(0),
    pseudolog_x: z.boolean().default(false),
    pseudolog_y: z.boolean().default(false),
    /** Base of the pseudolog transform asinh(v / 2) / ln(base) (v1: 2–10). */
    pseudolog_base: z.number().min(2).max(10).optional(),
    /** z-score x (thresholds then apply in SD units, so fc_threshold must be 0). */
    standardize_x: z.boolean().default(false),
    /** WebGL points (scattergl) for large tables. */
    webgl: z.boolean().default(true),
  })
  .superRefine((o, ctx) => {
    if (o.pseudolog_base !== undefined && !o.pseudolog_x && !o.pseudolog_y)
      fail(ctx, 'pseudolog_base', 'requires', 'Pick pseudolog X or Y for a base to apply.');
    if (o.pseudolog_y && o.y_transform === 'neg_log10')
      fail(ctx, 'pseudolog_y', 'conflict', 'y is already −log10(p); turn off the −log10 transform first.');
    if (o.standardize_x && o.fc_threshold > 0)
      fail(ctx, 'fc_threshold', 'conflict', 'With a z-scored x, set the fold-change threshold to 0.');
  });
export type VolcanoOptions = z.infer<typeof volcanoOptions>;

export const volcano: ChartDefinition = {
  type: 'volcano',
  label: 'Volcano',
  encodings: {
    x: { required: true, accepts: ['numeric'] },
    y: { required: true, accepts: ['numeric'] },
    color: { required: false, accepts: ['any'] },
    opacity: { required: false, accepts: ['numeric'] },
    hover: { required: false, accepts: ['any'], multiple: true },
    label: { required: false, accepts: ['categorical'] },
  },
  options: volcanoOptions,
  rules: (spec, options) =>
    (options as VolcanoOptions).label_top > 0 && !spec.encodings.label
      ? [{ code: 'requires', field: 'options.label_top', message: 'Choose a label column to label hits.' }]
      : [],
  dataRules: { minRows: 1, maxPoints: 500_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scattergl'],
};
