import { z } from 'zod';

// Compound selectivity profile (Phase 42, SEL-01/02): one profiling experiment (dose-response release) at a time.

export const SelectivityQuerySchema = z
  .strictObject({
    /** The profiling experiment (an experiment version); default: the most recent one with this compound. */
    version_id: z.uuid().optional(),
    /** S(x) threshold as pEC50 (−log10 EC50 in M): 6 = 1 µM. */
    pec50_min: z.coerce.number().min(3).max(12).default(6),
  })
  .meta({ id: 'SelectivityQuery' });
export type SelectivityQuery = z.infer<typeof SelectivityQuerySchema>;

const Figure = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  layout: z.record(z.string(), z.unknown()),
});

export const SelectivityProfileSchema = z.object({
  /** Proteins with a fitted curve for the compound in this experiment. */
  tested: z.int(),
  /** Proteins the source tool called regulated (up or down). */
  engaged: z.int(),
  engaged_without_pec50: z.int(),
  s_score: z.object({
    pec50_min: z.number(),
    ec50_max_molar: z.number(),
    engaged: z.int(),
    tested: z.int(),
    /** engaged / tested; null when nothing was tested. */
    score: z.number().nullable(),
  }),
  window: z.object({
    primary: z.object({ feature_id: z.string(), pec50: z.number() }).nullable(),
    next: z.object({ feature_id: z.string(), pec50: z.number() }).nullable(),
    /** Primary target pEC50 − most potent other engaged protein's pEC50 (log units). */
    delta: z.number().nullable(),
    /** Why there is no window. */
    note: z.string().nullable(),
  }),
  proteins: z.array(
    z.object({
      feature_id: z.string(),
      genes: z.string(),
      pec50: z.number().nullable(),
      regulation: z.string(),
      fdr: z.number().nullable(),
      known: z.enum(['primary_target', 'off_target']).nullable(),
    }),
  ),
});

export const SelectivityResponseSchema = z
  .object({
    compound_id: z.string(),
    /** Readable profiling experiments with curves for this compound, newest first. */
    experiments: z.array(
      z.object({
        version_id: z.uuid(),
        experiment_id: z.uuid(),
        experiment_name: z.string(),
        experiment_date: z.string().nullable(),
        program_code: z.string(),
        release_id: z.uuid(),
        method: z.string().nullable(),
      }),
    ),
    version_id: z.uuid().nullable(),
    profile: SelectivityProfileSchema.nullable(),
    /** Engaged proteins ranked by pEC50 (Plotly figure JSON; the page renders it, it computes nothing). */
    figure: Figure.nullable(),
    provenance: z.object({ release_id: z.uuid().nullable(), notes: z.array(z.string()) }),
  })
  .meta({ id: 'SelectivityResponse' });
export type SelectivityResponse = z.infer<typeof SelectivityResponseSchema>;
