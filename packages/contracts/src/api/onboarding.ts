import { z } from 'zod';
import { AssayTypeKeySchema } from '../template.ts';
import { FileRoleSchema } from './files.ts';

// Legacy onboarding (Phase 23, ING-06): bulk registration of a folder layout under a linkable prefix.
// Experiments, sample manifests and file roles come only from explicit path patterns; nothing is guessed.

const TOKEN = /\{([a-z_][a-z0-9_]*|\*)\}/g;

/** A path template relative to the prefix, e.g. `{experiment}/raw/{sample}.raw`. */
export const OnboardingPatternSchema = z
  .strictObject({
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'Not a valid path pattern')
      .refine(
        (p) => [...p.matchAll(TOKEN)].filter((m) => m[1] === 'experiment').length === 1,
        'A pattern needs exactly one {experiment} token',
      )
      .refine((p) => {
        const names = [...p.matchAll(TOKEN)].map((m) => m[1]).filter((n) => n !== '*');
        return new Set(names).size === names.length;
      }, 'A token may appear only once'),
    role: FileRoleSchema,
    /** Run this importer on every matching file once it has passed QC (batch importer runs). */
    importer: z.string().min(1).max(100).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'OnboardingPattern' });
export type OnboardingPattern = z.infer<typeof OnboardingPatternSchema>;

export const OnboardingSpecSchema = z
  .strictObject({
    program_id: z.uuid(),
    prefix: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine((p) => p.endsWith('/') && !p.startsWith('/') && !p.split('/').includes('..'), {
        message: 'A folder prefix ending in "/"',
      }),
    assay_type: AssayTypeKeySchema,
    /** Tried in order; the first matching pattern wins. Files no pattern matches are reported, not registered. */
    patterns: z.array(OnboardingPatternSchema).min(1).max(20),
    /** Manifest values for every inferred sample (values from the path take precedence). */
    sample_defaults: z.record(z.string().min(1).max(100), z.string().max(500)).optional(),
    /** Experiments processed per call; the rest stay pending until the run is resumed. */
    max_experiments: z.int().min(1).max(500).default(50),
  })
  .meta({ id: 'OnboardingSpec' });
export type OnboardingSpec = z.infer<typeof OnboardingSpecSchema>;

export const OnboardingPlanFileSchema = z.object({
  key: z.string(),
  size_bytes: z.int().nonnegative(),
  role: FileRoleSchema,
  sample_key: z.string().nullable(),
  importer: z.string().nullable(),
});

export const OnboardingPlanSchema = z
  .object({
    object_count: z.int().nonnegative(),
    experiments: z.array(
      z.object({
        name: z.string(),
        /** Inferred manifest rows: sample_key, tokens from the path, raw_file/instrument_run for raw files. */
        samples: z.array(z.record(z.string(), z.string())),
        files: z.array(OnboardingPlanFileSchema),
      }),
    ),
    unmatched: z.array(z.string()),
    /** Conflicting values inferred for the same sample (the first one is kept). */
    warnings: z.array(z.string()),
  })
  .meta({ id: 'OnboardingPlan' });
export type OnboardingPlan = z.infer<typeof OnboardingPlanSchema>;

const ItemStatusSchema = z.enum(['pending', 'done', 'failed']);
const CountsSchema = z.object({
  done: z.int().nonnegative(),
  pending: z.int().nonnegative(),
  failed: z.int().nonnegative(),
});

export const OnboardingItemSchema = z.object({
  kind: z.enum(['experiment', 'file', 'import']),
  /** Experiment name, or the object key (file and import items). */
  key: z.string(),
  experiment: z.string(),
  status: ItemStatusSchema,
  /** The experiment, file or release the item created or found. */
  entity_id: z.uuid().nullable(),
  error: z.string().nullable(),
  attempts: z.int().nonnegative(),
  /** File items: checksum, size and ingest status from the file record. */
  sha256: z.string().nullable(),
  size_bytes: z.int().nonnegative().nullable(),
  ingest_status: z.string().nullable(),
});

export const OnboardingRunSchema = z
  .object({
    id: z.uuid(),
    program_id: z.uuid(),
    prefix: z.string(),
    status: z.enum(['running', 'incomplete', 'completed', 'completed_with_failures']),
    created_at: z.string(),
    updated_at: z.string(),
    counts: z.object({ experiments: CountsSchema, files: CountsSchema, imports: CountsSchema }),
    totals: z.object({ files: z.int().nonnegative(), bytes: z.int().nonnegative() }),
    unmatched: z.array(z.string()),
    failures: z.array(OnboardingItemSchema),
    items: z.array(OnboardingItemSchema),
  })
  .meta({ id: 'OnboardingRun' });
export type OnboardingRun = z.infer<typeof OnboardingRunSchema>;
