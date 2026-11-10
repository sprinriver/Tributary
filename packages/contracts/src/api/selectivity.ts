import { z } from 'zod';

// Compound selectivity profile (Phase 42, SEL-01/02): one profiling experiment (dose-response release) at a time.

export const SelectivityQuerySchema = z
  .strictObject({
    /** The profiling dataset (a dose-response release); default: the most recent one with this compound. */
    release_id: z.uuid().optional(),
    /**
     * Which regulation calls count: both, or one direction (e.g. down for competition binding, where binding shows as
     * a decrease).
     */
    direction: z.enum(['both', 'down', 'up']).default('both'),
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
  /** Proteins (features) whose curve the tool classed: up, down or not. */
  tested: z.int(),
  /** Curves the tool left without a class (not counted as tested). */
  unclassified: z.int(),
  /** Proteins the tool called regulated (up or down), whatever the direction chosen. */
  regulated: z.int(),
  regulated_up: z.int(),
  regulated_down: z.int(),
  /** Regulated in the chosen direction but without a pEC50 (never in S). */
  regulated_without_pec50: z.int(),
  /** Features with more than one curve (each counted once, with its most potent regulated curve). */
  duplicates: z.int(),
  /** pEC50 span of the tested doses; null when the doses are unknown. */
  dose_range: z.object({ pec50_low: z.number(), pec50_high: z.number() }).nullable(),
  s_score: z.object({
    pec50_min: z.number(),
    ec50_max_molar: z.number(),
    direction: z.enum(['both', 'down', 'up']),
    regulated: z.int(),
    tested: z.int(),
    /** regulated (chosen direction, pEC50 ≥ threshold) / tested; null when nothing was tested. */
    score: z.number().nullable(),
  }),
  window: z.object({
    primary: z.object({ feature_id: z.string(), pec50: z.number() }).nullable(),
    next: z.object({ feature_id: z.string(), pec50: z.number() }).nullable(),
    /** Primary target pEC50 − most potent other regulated protein's pEC50 (log units). */
    delta: z.number().nullable(),
    /** Why there is no window. */
    note: z.string().nullable(),
  }),
  /** Regulated proteins in the chosen direction, most potent first. */
  proteins: z.array(
    z.object({
      feature_id: z.string(),
      genes: z.string(),
      pec50: z.number().nullable(),
      regulation: z.string(),
      fdr: z.number().nullable(),
      known: z.enum(['primary_target', 'off_target']).nullable(),
      /** A protein group of several accessions. */
      ambiguous: z.boolean(),
      outside_dose_range: z.boolean(),
    }),
  ),
  /** What was counted apart or flagged (unclassified curves, duplicates, dose range, ambiguous groups). */
  notes: z.array(z.string()),
});

export const SelectivityResponseSchema = z
  .object({
    compound_id: z.string(),
    /** Readable profiling datasets with curves for this compound (one entry per dataset), newest first. */
    experiments: z.array(
      z.object({
        version_id: z.uuid(),
        experiment_id: z.uuid(),
        experiment_name: z.string(),
        experiment_date: z.string().nullable(),
        program_code: z.string(),
        release_id: z.uuid(),
        dataset_name: z.string(),
        method: z.string().nullable(),
      }),
    ),
    version_id: z.uuid().nullable(),
    profile: SelectivityProfileSchema.nullable(),
    /** Regulated proteins ranked by pEC50 (Plotly figure JSON; the page renders it, it computes nothing). */
    figure: Figure.nullable(),
    provenance: z.object({ release_id: z.uuid().nullable(), notes: z.array(z.string()) }),
  })
  .meta({ id: 'SelectivityResponse' });
export type SelectivityResponse = z.infer<typeof SelectivityResponseSchema>;

export const SelectivityTableQuerySchema = z
  .strictObject({
    program_id: z.uuid().optional(),
    pec50_min: z.coerce.number().min(3).max(12).default(6),
    direction: z.enum(['both', 'down', 'up']).default('both'),
  })
  .meta({ id: 'SelectivityTableQuery' });

/** One row per compound and profiling dataset, grouped by dataset (Phase 43, SEL-04). */
export const SelectivityTableSchema = z
  .object({
    items: z.array(
      z.object({
        compound_id: z.string(),
        program_id: z.uuid(),
        release_id: z.uuid(),
        dataset_name: z.string(),
        experiment_id: z.uuid(),
        experiment_name: z.string(),
        experiment_date: z.string().nullable(),
        program_code: z.string(),
        method: z.string().nullable(),
        tested: z.int(),
        unclassified: z.int(),
        regulated: z.int(),
        regulated_down: z.int(),
        regulated_up: z.int(),
        regulated_without_pec50: z.int(),
        /** Regulated in the chosen direction with pEC50 ≥ the threshold. */
        s_regulated: z.int(),
        s_score: z.number().nullable(),
        /** ranked: something is regulated at the threshold; inactive: nothing is; no_score: nothing was tested. */
        status: z.enum(['ranked', 'inactive', 'no_score']),
        primary: z.object({ feature_id: z.string(), pec50: z.number() }).nullable(),
        window_delta: z.number().nullable(),
        window_note: z.string().nullable(),
        /** Warnings from the profile (threshold or potencies outside the tested doses, unclassified curves…). */
        flags: z.array(z.string()),
      }),
    ),
    thresholds: z.object({
      pec50_min: z.number(),
      ec50_max_molar: z.number(),
      direction: z.enum(['both', 'down', 'up']),
    }),
    /** Datasets not read, and why (never read partly). */
    skipped: z.array(z.object({ experiment_name: z.string(), dataset_name: z.string(), reason: z.string() })),
    notes: z.array(z.string()),
  })
  .meta({ id: 'SelectivityTable' });
export type SelectivityTable = z.infer<typeof SelectivityTableSchema>;
