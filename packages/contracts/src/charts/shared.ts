import { z } from 'zod';
import { CLUSTER_METHODS, DISTANCE_METRICS, EUCLIDEAN_ONLY_METHODS } from '../compute.ts';

/** A cross-field rule failure at `options.<path>` with our error code (REFERENCE_V1 §8: schema-level requires). */
export function fail(
  ctx: z.RefinementCtx,
  path: string,
  code: 'requires' | 'conflict' | 'range',
  message: string,
) {
  ctx.addIssue({ code: 'custom', path: [path], message, params: { code } });
}

export const clusteringShape = {
  method: z.enum(CLUSTER_METHODS).default('average'),
  metric: z.enum(DISTANCE_METRICS).default('euclidean'),
  leaf_ordering: z.enum(['default', 'optimal']).default('default'),
};

/** centroid, median and ward.D2 are defined on Euclidean distances only. */
export function euclideanRule(ctx: z.RefinementCtx, o: { method: string; metric: string }) {
  if (EUCLIDEAN_ONLY_METHODS.includes(o.method) && o.metric !== 'euclidean')
    fail(ctx, 'metric', 'requires', `${o.method} linkage needs the euclidean distance.`);
}

export const scaleSchema = z.enum(['none', 'zscore_rows', 'zscore_columns']).default('none');
