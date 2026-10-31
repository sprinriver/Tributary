import { z } from 'zod';
import { TimestampSchema } from '../common.ts';
import { RunnerSchema, RunStatusSchema } from '../entities/platform.ts';
import { AssayTypeKeySchema } from '../template.ts';

// SPEC M4 / §7.4 — pipeline definitions, runs, status history, logs.

export type RunStatus = z.infer<typeof RunStatusSchema>;
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled'];

export const RunnerKindSchema = RunnerSchema;
export type RunnerKind = z.infer<typeof RunnerKindSchema>;

const ParamValueSchema = z.union([z.string().max(2000), z.number(), z.boolean()]);
const ParamsSchema = z.record(
  z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, 'Parameter names are letters, digits, _ and -'),
  ParamValueSchema,
);

export const PipelineDefinitionBodySchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
    name: z.string().trim().min(1).max(200),
    /** nf-core/<name>, a git URL, or a local `pipelines/<dir>` for the local runner. */
    repo: z.string().trim().min(1).max(500),
    revision: z.string().trim().min(1).max(100),
    runner_types: z.array(RunnerKindSchema).min(1),
    assay_types: z.array(AssayTypeKeySchema).min(1),
    params_schema: z.record(z.string(), z.unknown()).default({}),
    default_params: ParamsSchema.default({}),
    /** Importer key → output path relative to the run's output prefix. */
    output_importers: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.string().min(1).max(500)).default({}),
  })
  .meta({ id: 'PipelineDefinitionBody' });

export const PipelineSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    name: z.string(),
    repo: z.string(),
    revision: z.string(),
    runner_types: z.array(RunnerKindSchema),
    assay_types: z.array(AssayTypeKeySchema),
    params_schema: z.record(z.string(), z.unknown()),
    default_params: z.record(z.string(), ParamValueSchema),
    output_importers: z.record(z.string(), z.string()),
    created_at: TimestampSchema,
  })
  .meta({ id: 'Pipeline' });
export type Pipeline = z.infer<typeof PipelineSchema>;

export const PipelineListSchema = z.object({ items: z.array(PipelineSchema) }).meta({ id: 'PipelineList' });

export const LaunchRunBodySchema = z
  .strictObject({
    pipeline_definition_id: z.uuid(),
    experiment_version_id: z.uuid(),
    runner: RunnerKindSchema,
    params: ParamsSchema.default({}),
  })
  .meta({ id: 'LaunchRunBody' });

export const LogLinkSchema = z.object({ label: z.string(), url: z.string() });
export type LogLink = z.infer<typeof LogLinkSchema>;

export const RunEventSchema = z.object({
  status: RunStatusSchema,
  external_status: z.string(),
  at: TimestampSchema,
  source: z.enum(['api', 'event', 'poll']),
  reason: z.string().nullable(),
  applied: z.boolean(),
});

export const RunSummarySchema = z
  .object({
    id: z.uuid(),
    pipeline_definition_id: z.uuid(),
    pipeline_key: z.string(),
    pipeline_name: z.string(),
    experiment_version_id: z.uuid(),
    runner: RunnerKindSchema,
    external_id: z.string().nullable(),
    status: RunStatusSchema,
    status_reason: z.string().nullable(),
    created_at: TimestampSchema,
    started_at: TimestampSchema.nullable(),
    finished_at: TimestampSchema.nullable(),
  })
  .meta({ id: 'RunSummary' });
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunDetailSchema = RunSummarySchema.extend({
  params: z.record(z.string(), ParamValueSchema),
  work_dir: z.string().nullable(),
  output_uri: z.string().nullable(),
  log_links: z.array(LogLinkSchema),
  cost_estimate: z.number().nullable(),
  triggered_by: z.uuid(),
  events: z.array(RunEventSchema),
  outputs: z.array(
    z.object({
      file_id: z.uuid(),
      name: z.string(),
      ingest_status: z.string(),
      release_id: z.uuid().nullable(),
      release_status: z.string().nullable(),
    }),
  ),
}).meta({ id: 'RunDetail' });
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const RunListSchema = z.object({ items: z.array(RunSummarySchema) }).meta({ id: 'RunList' });

export const RunLogsSchema = z
  .object({ links: z.array(LogLinkSchema), lines: z.array(z.string()) })
  .meta({ id: 'RunLogs' });

/** In-app notifications (SPEC M4): the caller's runs of the last 7 days, newest first. */
export const MyRunSchema = RunSummarySchema.extend({
  experiment_id: z.uuid(),
  experiment_name: z.string(),
}).meta({ id: 'MyRun' });
export type MyRun = z.infer<typeof MyRunSchema>;
export const MyRunListSchema = z.object({ items: z.array(MyRunSchema) }).meta({ id: 'MyRunList' });
