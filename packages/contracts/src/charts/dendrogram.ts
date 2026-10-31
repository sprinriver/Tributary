import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';
import { clusteringShape, euclideanRule, fail, scaleSchema } from './shared.ts';
import { matrixEncodings, matrixRules } from './heatmap.ts';

/** Dendrogram (REFERENCE_V1 §7): methods, metrics, leaf ordering, orientation, colours, bootstrap support. */
export const dendrogramOptions = z
  .strictObject({
    axis: z.enum(['rows', 'columns', 'both']).default('rows'),
    ...clusteringShape,
    orientation: z.enum(['left', 'right', 'top', 'bottom']).default('left'),
    /** step = right-angled links; linear = straight links. */
    interpolation: z.enum(['step', 'linear']).default('step'),
    color_scheme: z.enum(['single', 'gradient', 'cluster']).default('single'),
    /** Link height below which subtrees get their own colour (cluster colouring). */
    color_threshold: z.number().min(0).optional(),
    bootstrap_n: z.int().min(0).max(1000).default(0),
    seed: z.int().min(0).default(1),
    attach_heatmap: z.boolean().default(false),
    standardize: scaleSchema,
  })
  .superRefine((o, ctx) => {
    if (o.color_threshold !== undefined && o.color_scheme !== 'cluster')
      fail(ctx, 'color_threshold', 'requires', 'A colour threshold applies to cluster colouring.');
    euclideanRule(ctx, o);
  });
export type DendrogramOptions = z.infer<typeof dendrogramOptions>;

export const dendrogram: ChartDefinition = {
  type: 'dendrogram',
  label: 'Dendrogram',
  encodings: matrixEncodings,
  options: dendrogramOptions,
  rules: matrixRules,
  dataRules: { minRows: 2, maxPoints: 200_000, nullPolicy: 'drop-and-report' },
  compute: 'python',
  traces: ['scatter', 'heatmap'],
};
