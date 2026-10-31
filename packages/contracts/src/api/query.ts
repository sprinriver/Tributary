import { z } from 'zod';
import { TimestampSchema } from '../common.ts';
import { ColumnTypeSchema, DatasetKindSchema } from '../datasets/index.ts';
import { QuerySpecSchema } from '../query.ts';
import { ReleaseStorageSchema } from './datasets.ts';

// SPEC §7.1 / M6 — QuerySpec results and exports. Raw SQL is never accepted.

export const QueryResultSchema = z
  .object({
    rows: z.array(z.record(z.string(), z.unknown())),
    columns: z.array(z.object({ name: z.string(), type: ColumnTypeSchema })),
    /** Rows matching the spec, counted up to a cap (`totalCapped` says the true count is higher). */
    totalRows: z.int().nonnegative(),
    totalCapped: z.boolean(),
    nextCursor: z.string().nullable(),
    /** sha256 of the compiled SQL and its parameters (cache key, provenance). */
    sqlHash: z.string().regex(/^[0-9a-f]{64}$/),
    elapsedMs: z.number().nonnegative(),
  })
  .meta({ id: 'QueryResult' });
export type QueryResult = z.infer<typeof QueryResultSchema>;

export const EXPORT_FORMATS = ['csv', 'tsv', 'parquet'] as const;
export const ExportFormatSchema = z.enum(EXPORT_FORMATS);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const QueryExportBodySchema = z
  .strictObject({ spec: QuerySpecSchema, format: ExportFormatSchema })
  .meta({ id: 'QueryExportBody' });

export const QueryExportSchema = z
  .object({
    /** Presigned GET URL of the exported file. */
    url: z.string().url(),
    expires_at: TimestampSchema,
    format: ExportFormatSchema,
    row_count: z.int().nonnegative(),
    sql_hash: z.string(),
  })
  .meta({ id: 'QueryExport' });

/** A source after program scoping (apps/api → apps/query): concrete release files or a metadata scope. */
export const ResolvedSourceSchema = z.union([
  z.strictObject({
    kind: DatasetKindSchema,
    releases: z.array(z.strictObject({ release_id: z.uuid(), storage: ReleaseStorageSchema })),
  }),
  z.strictObject({
    kind: z.enum(['experiment_version', 'sample', 'file_object', 'pipeline_run']),
    metadata: z.strictObject({
      /** null = every program (system admin). */
      program_ids: z.array(z.uuid()).nullable(),
      experiment_version_ids: z.array(z.uuid()).optional(),
    }),
  }),
]);
export type ResolvedSource = z.infer<typeof ResolvedSourceSchema>;

export const InternalQueryRequestSchema = z.strictObject({
  spec: QuerySpecSchema,
  source: ResolvedSourceSchema,
  joins: z.array(ResolvedSourceSchema),
  /** Charts: every row up to this many in one response (pages are for the grid). */
  all_rows: z.int().positive().max(1_000_000).optional(),
  /** Present for exports: where the query service writes the file. */
  export: z.strictObject({ format: ExportFormatSchema, bucket: z.string(), key: z.string() }).optional(),
});
export type InternalQueryRequest = z.infer<typeof InternalQueryRequestSchema>;

export const InternalExportResultSchema = z.object({
  row_count: z.int().nonnegative(),
  sql_hash: z.string(),
  bucket: z.string(),
  key: z.string(),
});
export type InternalExportResult = z.infer<typeof InternalExportResultSchema>;
