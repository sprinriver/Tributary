import { z } from 'zod';

// Cross-experiment QC and batch-effect overview (Phase 27, QCD-01…03): per-run metrics from the latest published
// protein-quantity releases of the programs the caller can read, outlier runs, and a PCA of runs coloured by a factor.

export const QcColorBySchema = z.enum(['experiment', 'plate', 'condition', 'experiment_date']);

/** A run is flagged when its identifications fall below this fraction of its experiment's median. */
export const QC_LOW_ID_FRACTION = 0.5;

export const QcOverviewBodySchema = z
  .strictObject({
    program_id: z.uuid().optional(),
    color_by: QcColorBySchema.default('experiment'),
    /** Experiments read, newest first (the overview reads every protein row of each). */
    max_experiments: z.int().min(1).max(100).default(20),
  })
  .meta({ id: 'QcOverviewBody' });
export type QcOverviewBody = z.infer<typeof QcOverviewBodySchema>;

const Figure = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  layout: z.record(z.string(), z.unknown()),
});

export const QcRunSchema = z.object({
  experiment_id: z.uuid(),
  experiment_name: z.string(),
  experiment_date: z.string().nullable(),
  program_code: z.string(),
  release_id: z.uuid(),
  sample_key: z.string(),
  /** Protein groups with an intensity > 0 (tools write 0 or nothing for not quantified). */
  ids: z.int(),
  /** % of the experiment's protein groups not quantified in this run. */
  missing_pct: z.number(),
  /** Median log2 intensity of the quantified protein groups (apps/compute). */
  median_log2_intensity: z.number().nullable(),
  flagged: z.boolean(),
  /** Manifest values used for colouring (plate, condition). */
  factors: z.record(z.string(), z.string()),
});
export type QcRun = z.infer<typeof QcRunSchema>;

export const QcOverviewSchema = z
  .object({
    runs: z.array(QcRunSchema),
    experiments: z.array(
      z.object({
        experiment_id: z.uuid(),
        experiment_name: z.string(),
        experiment_date: z.string().nullable(),
        program_code: z.string(),
        runs: z.int(),
        median_ids: z.number().nullable(),
        flagged_runs: z.int(),
      }),
    ),
    figures: z.object({ trend: Figure, pca: Figure.nullable() }),
    provenance: z.object({
      release_ids: z.array(z.uuid()),
      color_by: QcColorBySchema,
      /** Protein groups quantified in every run (the PCA's features); null when no PCA could be made. */
      pca_features: z.int().nullable(),
      pca_explained: z.array(z.number()).nullable(),
      /** Why there is no PCA, when there is none. */
      pca_note: z.string().nullable(),
      transformations: z.array(z.string()),
      compute: z.record(z.string(), z.string()),
    }),
  })
  .meta({ id: 'QcOverview' });
export type QcOverview = z.infer<typeof QcOverviewSchema>;
