import { z } from 'zod';
import { ChartSpecSchema } from '../charts.ts';

// SPEC M7 / §8: ChartSpec → Plotly figure JSON, with provenance.

export const ChartRenderBodySchema = z
  .strictObject({ spec: ChartSpecSchema })
  .meta({ id: 'ChartRenderBody' });

export const ChartProvenanceSchema = z
  .object({
    release_ids: z.array(z.uuid()),
    /** Hash of the compiled query (same as the Data Explorer's). */
    sql_hash: z.string(),
    /** The spec as rendered, options with their defaults. */
    chart_spec: ChartSpecSchema,
    /** Rows plotted, and rows dropped by the chart's null policy (reported, never silent). */
    rows: z.int().nonnegative(),
    dropped_rows: z.int().nonnegative(),
    /** Compute versions and seeds used (e.g. clustering). */
    compute: z.record(z.string(), z.union([z.string(), z.number()])),
    /** Transformations applied for display (pseudolog, z-scores, −log10). */
    transformations: z.array(z.string()),
    rendered_at: z.string(),
  })
  .meta({ id: 'ChartProvenance' });
export type ChartProvenance = z.infer<typeof ChartProvenanceSchema>;

export const ChartRenderSchema = z
  .object({
    figure: z.object({
      data: z.array(z.record(z.string(), z.unknown())),
      layout: z.record(z.string(), z.unknown()),
    }),
    provenance: ChartProvenanceSchema,
  })
  .meta({ id: 'ChartRender' });
export type ChartRender = z.infer<typeof ChartRenderSchema>;
