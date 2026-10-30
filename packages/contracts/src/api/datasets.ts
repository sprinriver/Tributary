import { z } from 'zod';
import { TimestampSchema } from '../common.ts';
import { DatasetContractSchema, DatasetKindSchema } from '../datasets/types.ts';

// SPEC M5 — dataset releases: importer runs (apps/query), release lifecycle, catalog.

export const RuleFailureSchema = z.object({
  rule_id: z.string(),
  severity: z.enum(['error', 'warn']),
  failing_rows: z.int().nonnegative(),
  message: z.string(),
  source: z.string(),
  examples: z.array(z.string()),
});
export type RuleFailure = z.infer<typeof RuleFailureSchema>;

export const ColumnStatsSchema = z.object({
  null_count: z.int().nonnegative(),
  distinct_count: z.int().nonnegative(),
  min: z.union([z.number(), z.string()]).nullable().optional(),
  max: z.union([z.number(), z.string()]).nullable().optional(),
});

export const TransformationSchema = z.object({ step: z.string(), detail: z.string() });

export const ReleaseSourceSchema = z
  .object({
    importer: z.string(),
    importer_version: z.string(),
    tool: z.string(),
    tool_version: z.string(),
    original_columns: z.array(z.string()),
    delimiter: z.string(),
    decimal: z.enum(['.', ',']),
    na_tokens: z.array(z.string()),
    mapping: z.record(z.string(), z.string()).optional(),
    file: z
      .object({
        id: z.uuid(),
        name: z.string(),
        sha256: z.string().nullable(),
        bucket: z.string(),
        key: z.string(),
      })
      .optional(),
  })
  .meta({ id: 'ReleaseSource' });

/** Where a release's rows live: one immutable Parquet object (ADR 0017). */
export const ReleaseStorageSchema = z
  .object({
    format: z.literal('parquet'),
    bucket: z.string(),
    key: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size_bytes: z.int().nonnegative(),
  })
  .meta({ id: 'ReleaseStorage' });
export type ReleaseStorage = z.infer<typeof ReleaseStorageSchema>;

const RunSchema = z.object({
  sample_key: z.string(),
  instrument_run: z.string().nullable(),
  raw_file: z.string().nullable(),
  condition: z.string().nullable().optional(),
});

/** API → apps/query: run one importer over a stored file and, if it passes, write the release object. */
export const ImportRunRequestSchema = z
  .strictObject({
    importer: z.string().min(1).max(100),
    source: z.object({ bucket: z.string(), key: z.string(), name: z.string() }),
    context: z.object({
      experiment_version_id: z.uuid().optional(),
      program_id: z.uuid(),
      runs: z.array(RunSchema).optional(),
      contrast: z.object({ id: z.uuid(), label: z.string() }).optional(),
      /** All registered contrasts (tables holding several comparisons, e.g. MSstats). */
      contrasts: z.array(z.object({ id: z.uuid(), label: z.string() })).optional(),
      options: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({ bucket: z.string(), key: z.string() }),
  })
  .meta({ id: 'ImportRunRequest' });
export type ImportRunRequest = z.infer<typeof ImportRunRequestSchema>;

export const ImportRunResultSchema = z
  .object({
    importer: z.string(),
    kind: DatasetKindSchema,
    contract_version: z.string(),
    passed: z.boolean(),
    row_count: z.int().nonnegative(),
    failures: z.array(RuleFailureSchema),
    column_stats: z.record(z.string(), ColumnStatsSchema),
    transformations: z.array(TransformationSchema),
    source: ReleaseSourceSchema,
    /** Null when a rule failed: nothing is written. */
    output: ReleaseStorageSchema.nullable(),
  })
  .meta({ id: 'ImportRunResult' });
export type ImportRunResult = z.infer<typeof ImportRunResultSchema>;

/** A request-level import problem (wrong importer, missing mapping) from apps/query. */
export const ImportProblemSchema = z.object({ code: z.string(), message: z.string() });

export const ReleaseReadRequestSchema = z
  .strictObject({
    storage: ReleaseStorageSchema,
    limit: z.int().min(1).max(1000).default(50),
    order_by: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .max(10)
      .optional(),
  })
  .meta({ id: 'ReleaseReadRequest' });

export const ReleasePreviewSchema = z
  .object({ row_count: z.int().nonnegative(), rows: z.array(z.record(z.string(), z.unknown())) })
  .meta({ id: 'ReleasePreview' });
export type ReleasePreview = z.infer<typeof ReleasePreviewSchema>;

export const ReleaseStatusSchema = z.enum(['staged', 'published', 'rejected']);

export const StartImportBodySchema = z
  .strictObject({
    file_id: z.uuid(),
    importer: z.string().min(1).max(100),
    /** Defaults to the importer's kind; releases of the same dataset name accumulate. */
    dataset_name: z.string().trim().min(1).max(200).optional(),
    contrast_id: z.uuid().optional(),
    /** custom_tabular: a saved preset instead of inline options. */
    preset_id: z.uuid().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'StartImportBody' });

export const ReleaseReasonBodySchema = z
  .strictObject({ reason: z.string().trim().min(3, 'Give a reason').max(2000) })
  .meta({ id: 'ReleaseReasonBody' });

export const ReleaseSummarySchema = z
  .object({
    id: z.uuid(),
    dataset_id: z.uuid(),
    release_number: z.int().positive(),
    status: ReleaseStatusSchema,
    row_count: z.int().nonnegative(),
    importer: z.string().nullable(),
    created_at: TimestampSchema,
    published_at: TimestampSchema.nullable(),
  })
  .meta({ id: 'ReleaseSummary' });

export const ReleaseDetailSchema = ReleaseSummarySchema.extend({
  kind: DatasetKindSchema,
  dataset_name: z.string(),
  program_id: z.uuid(),
  program_code: z.string(),
  experiment_version_id: z.uuid().nullable(),
  experiment_id: z.uuid().nullable(),
  experiment_name: z.string().nullable(),
  contract_version: z.string(),
  contract: DatasetContractSchema,
  column_stats: z.record(z.string(), ColumnStatsSchema),
  transformations: z.array(TransformationSchema),
  source: ReleaseSourceSchema,
  storage: ReleaseStorageSchema.nullable(),
  validation: z.object({ passed: z.boolean(), failures: z.array(RuleFailureSchema) }),
  status_reason: z.string().nullable(),
  /** Lineage stub until Phase 18: the input file. */
  lineage: z.object({
    inputs: z.array(z.object({ type: z.literal('file'), id: z.uuid(), name: z.string() })),
  }),
}).meta({ id: 'ReleaseDetail' });
export type ReleaseDetail = z.infer<typeof ReleaseDetailSchema>;

export const DatasetSummarySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: DatasetKindSchema,
    category: z.enum(['experiment', 'reference', 'metadata']),
    program_id: z.uuid(),
    program_code: z.string(),
    experiment_version_id: z.uuid().nullable(),
    experiment_id: z.uuid().nullable(),
    experiment_name: z.string().nullable(),
    version_number: z.int().nullable(),
    release_count: z.int().nonnegative(),
    latest_release: ReleaseSummarySchema.nullable(),
    created_at: TimestampSchema,
  })
  .meta({ id: 'DatasetSummary' });
export type DatasetSummary = z.infer<typeof DatasetSummarySchema>;

export const DatasetListSchema = z
  .object({ items: z.array(DatasetSummarySchema) })
  .meta({ id: 'DatasetList' });

export const ListDatasetsQuerySchema = z
  .strictObject({
    kind: DatasetKindSchema.optional(),
    program_id: z.uuid().optional(),
    experiment_version_id: z.uuid().optional(),
    q: z.string().trim().max(200).optional(),
  })
  .meta({ id: 'ListDatasetsQuery' });

export const DatasetDetailSchema = DatasetSummarySchema.extend({
  releases: z.array(ReleaseSummarySchema),
}).meta({ id: 'DatasetDetail' });

export const PreviewQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ImporterInfoSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: DatasetKindSchema,
  tool: z.string(),
  formats: z.array(z.string()),
  /** Kinds this importer can target (custom_tabular: any importable kind). */
  kinds: z.array(DatasetKindSchema),
  needs: z.array(
    z.enum(['experiment_version', 'contrast', 'contrasts', 'mapping', 'source_release', 'doses']),
  ),
});
export const ImporterListSchema = z
  .object({ items: z.array(ImporterInfoSchema) })
  .meta({ id: 'ImporterList' });
export type ImporterInfo = z.infer<typeof ImporterInfoSchema>;

export const ImportPresetBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    kind: DatasetKindSchema,
    columns: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().min(1).max(300)),
    constants: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().max(300)).optional(),
  })
  .meta({ id: 'ImportPresetBody' });

export const ImportPresetSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: DatasetKindSchema,
    columns: z.record(z.string(), z.string()),
    constants: z.record(z.string(), z.string()),
    created_at: TimestampSchema,
  })
  .meta({ id: 'ImportPreset' });
