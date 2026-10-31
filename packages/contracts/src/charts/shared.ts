import { z } from 'zod';
import type { EncodingDef } from '../charts.ts';
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

/** Pseudolog flags for the given axes plus the shared base (v1: 2–10, typed, requires a flag). */
export function pseudologShape<A extends 'x' | 'y' | 'z'>(axes: readonly A[]) {
  return {
    ...(Object.fromEntries(axes.map((a) => [`pseudolog_${a}`, z.boolean().default(false)])) as Record<
      `pseudolog_${A}`,
      z.ZodDefault<z.ZodBoolean>
    >),
    pseudolog_base: z.number().min(2).max(10).optional(),
  };
}

export function pseudologRule(ctx: z.RefinementCtx, o: Record<string, unknown>) {
  const any = Object.entries(o).some(
    ([k, v]) => k.startsWith('pseudolog_') && k !== 'pseudolog_base' && v === true,
  );
  if (o.pseudolog_base !== undefined && !any)
    fail(ctx, 'pseudolog_base', 'requires', 'Pick a pseudolog axis for a base to apply.');
}

/** A chart-level rule that needs an encoding (e.g. point labels need a label column). */
export const needsEncoding =
  (option: string, active: (o: Record<string, unknown>) => boolean, slot: string, message: string) =>
  (spec: { encodings: Record<string, unknown> }, options: unknown) =>
    active(options as Record<string, unknown>) && !spec.encodings[slot]
      ? [{ code: 'requires', field: `options.${option}`, message }]
      : [];

/** Optional encodings most v1 charts share (REFERENCE_V1 §7). */
export const COMMON: Record<'color' | 'shape' | 'opacity' | 'hover' | 'panel' | 'label', EncodingDef> = {
  color: { required: false, accepts: ['any'] },
  shape: { required: false, accepts: ['categorical'] },
  opacity: { required: false, accepts: ['numeric'] },
  hover: { required: false, accepts: ['any'], multiple: true },
  panel: { required: false, accepts: ['categorical'] },
  label: { required: false, accepts: ['categorical'] },
};

/** p-values test the groups across all rows; with colour or panel splits the chart shows groups the test pools. */
export const pooledPValues =
  (groups: string, slots: readonly string[] = ['color', 'panel']) =>
  (spec: { encodings: Record<string, unknown> }, options: unknown) => {
    const o = options as Record<string, unknown>;
    const split = slots.find((s) => spec.encodings[s]);
    return o.p_values !== 'none' && split
      ? [
          {
            code: 'conflict',
            field: 'options.p_values',
            message: `p-values compare ${groups} over all rows; remove the ${split === 'color' ? 'colour' : 'panel'} split or turn p-values off.`,
          },
        ]
      : [];
  };
