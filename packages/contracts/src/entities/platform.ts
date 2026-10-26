import { z } from 'zod';
import { BaseEntityShape, JsonObjectSchema, TimestampSchema, UuidV7Schema } from '../common.ts';
import { DatasetKindSchema } from '../datasets/index.ts';
import { ChartSpecSchema } from '../charts.ts';
import { QuerySpecSchema } from '../query.ts';
import { AssayTypeKeySchema } from '../template.ts';

// SPEC §4 — files, datasets, pipelines, reference data, views, lineage, audit and access.

/** SPEC §7.3, shared by files and dataset releases. */
export const IngestStatusSchema = z.enum([
  'registered',
  'uploading',
  'uploaded',
  'type_detected',
  'contract_validated',
  'qc_passed',
  'qc_failed',
  'published',
  'rejected',
]);

export const FileObjectSchema = z
  .object({
    ...BaseEntityShape,
    bucket: z.string().min(1),
    key: z.string().min(1),
    s3_version_id: z.string().nullable(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size_bytes: z.int().nonnegative(),
    format: z.string().nullable(),
    declared_format: z.string().nullable(),
    storage_class: z.string(),
    ingest_status: IngestStatusSchema,
    qc_report: JsonObjectSchema.nullable(),
  })
  .meta({ id: 'FileObject' });

export const DatasetSchema = z
  .object({
    ...BaseEntityShape,
    kind: DatasetKindSchema,
    experiment_version_id: UuidV7Schema.nullable(),
    program_id: UuidV7Schema,
    name: z.string().min(1),
  })
  .meta({ id: 'Dataset' });

export const DatasetReleaseSchema = z
  .object({
    ...BaseEntityShape,
    dataset_id: UuidV7Schema,
    release_number: z.int().positive(),
    contract_version: z.string(),
    storage: z.discriminatedUnion('type', [
      z.object({ type: z.literal('iceberg'), table: z.string(), snapshot_id: z.string() }),
      z.object({ type: z.literal('parquet'), prefix: z.string() }),
    ]),
    row_count: z.int().nonnegative(),
    column_stats: JsonObjectSchema,
    source: z.object({
      tool: z.string(),
      tool_version: z.string(),
      importer: z.string(),
      importer_version: z.string(),
      pipeline_run_id: UuidV7Schema.nullable(),
      file_ids: z.array(UuidV7Schema),
    }),
    /** Every melt, split, unit conversion or filter applied on import, in order. */
    transformations: z.array(JsonObjectSchema),
    status: z.enum(['staged', 'published', 'rejected']),
    published_at: TimestampSchema.nullable(),
  })
  .meta({ id: 'DatasetRelease' });

export const RunnerSchema = z.enum(['local', 'aws_batch', 'healthomics']);
/** SPEC §7.4. */
export const RunStatusSchema = z.enum([
  'submitted',
  'pending',
  'starting',
  'running',
  'stopping',
  'succeeded',
  'failed',
  'cancelled',
]);

export const PipelineDefinitionSchema = z
  .object({
    ...BaseEntityShape,
    key: z.string().min(1),
    name: z.string().min(1),
    repo: z.string().min(1),
    revision: z.string().min(1),
    runner_types: z.array(RunnerSchema).min(1),
    assay_types: z.array(AssayTypeKeySchema).min(1),
    params_schema: JsonObjectSchema,
    default_params: JsonObjectSchema,
    output_importers: z.record(z.string(), z.string()),
  })
  .meta({ id: 'PipelineDefinition' });

export const PipelineRunSchema = z
  .object({
    ...BaseEntityShape,
    pipeline_definition_id: UuidV7Schema,
    experiment_version_id: UuidV7Schema,
    runner: RunnerSchema,
    external_id: z.string().nullable(),
    status: RunStatusSchema,
    params: JsonObjectSchema,
    work_dir: z.string().nullable(),
    output_uri: z.string().nullable(),
    log_links: z.array(z.object({ label: z.string(), url: z.url() })),
    started_at: TimestampSchema.nullable(),
    finished_at: TimestampSchema.nullable(),
    cost_estimate: z.number().nonnegative().nullable(),
    triggered_by: UuidV7Schema,
  })
  .meta({ id: 'PipelineRun' });

export const CompoundSchema = z
  .object({
    ...BaseEntityShape,
    compound_id: z.string().min(1),
    batch_id: z.string().nullable(),
    name: z.string().nullable(),
    smiles: z.string().nullable(),
    inchikey: z.string().nullable(),
    external_ids: z.record(z.string(), z.string()),
    program_id: UuidV7Schema,
  })
  .meta({ id: 'Compound' });

export const CompoundPropertySchema = z
  .object({
    ...BaseEntityShape,
    compound_id: z.string().min(1),
    property: z.string().min(1),
    value: z.number().nullable(),
    unit: z.string().nullable(),
    qualifier: z.enum(['=', '<', '>']),
    assay_category: z.enum(['ADME', 'physchem', 'binding', 'functional', 'tox']),
    assay_name: z.string().nullable(),
  })
  .meta({ id: 'CompoundProperty' });

export const TargetAnnotationSchema = z
  .object({
    ...BaseEntityShape,
    uniprot_accession: z.string().min(1),
    gene_symbol: z.string().nullable(),
    family: z.string().nullable(),
    key: z.string().min(1),
    value: z.string().nullable(),
  })
  .meta({ id: 'TargetAnnotation' });

export const SavedViewSchema = z
  .object({
    ...BaseEntityShape,
    name: z.string().min(1),
    owner: UuidV7Schema,
    query_spec: QuerySpecSchema,
    chart_spec: ChartSpecSchema.nullable(),
    visibility: z.enum(['private', 'program']),
    share_token: z.string().nullable(),
  })
  .meta({ id: 'SavedView' });

export const LineageNodeSchema = z
  .object({
    ...BaseEntityShape,
    kind: z.enum(['file', 'dataset_release', 'pipeline_run', 'experiment_version', 'chart', 'ai_artifact']),
    entity_id: UuidV7Schema,
  })
  .meta({ id: 'LineageNode' });

export const LineageEdgeSchema = z
  .object({
    ...BaseEntityShape,
    from_node_id: UuidV7Schema,
    to_node_id: UuidV7Schema,
    relation: z.enum(['input_to', 'produced', 'derived_from', 'describes']),
  })
  .meta({ id: 'LineageEdge' });

/** Append-only (no UPDATE/DELETE grants). */
export const AuditEventSchema = z
  .object({
    id: UuidV7Schema,
    actor_id: UuidV7Schema,
    actor_type: z.enum(['user', 'service', 'ai_assistant_on_behalf_of']),
    action: z.string().min(1),
    entity_type: z.string().min(1),
    entity_id: UuidV7Schema,
    before: JsonObjectSchema.nullable(),
    after: JsonObjectSchema.nullable(),
    reason: z.string().nullable(),
    request_id: z.string().min(1),
    ip: z.union([z.ipv4(), z.ipv6()]).nullable(),
    at: TimestampSchema,
  })
  .meta({ id: 'AuditEvent' });
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const UserSchema = z
  .object({
    ...BaseEntityShape,
    sub: z.string().min(1),
    email: z.email(),
    name: z.string(),
    groups: z.array(z.string()),
  })
  .meta({ id: 'User' });

export const GroupSchema = z.object({ ...BaseEntityShape, name: z.string().min(1) }).meta({ id: 'Group' });

export const RoleBindingSchema = z
  .object({
    ...BaseEntityShape,
    principal: z.discriminatedUnion('type', [
      z.object({ type: z.literal('user'), user_id: UuidV7Schema }),
      z.object({ type: z.literal('group'), group_id: UuidV7Schema }),
    ]),
    /** null = global binding (only `system_admin`). */
    program_id: UuidV7Schema.nullable(),
    role: z.enum(['viewer', 'contributor', 'approver', 'admin', 'system_admin']),
  })
  .meta({ id: 'RoleBinding' });
