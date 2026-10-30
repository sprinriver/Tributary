import { z } from 'zod';
import { DateSchema, OntologyTermSchema, TimestampSchema, UuidV7Schema } from '../common.ts';
import { ContractErrorSchema } from '../errors.ts';
import { QuantitySchema } from '../quantity.ts';
import { AssayTypeKeySchema, MetadataFieldDefSchema } from '../template.ts';

// Request and response shapes of the registry API (SPEC M1, §8).

const CustomValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const VersionFieldsShape = {
  experiment_date: DateSchema.nullable().optional(),
  species: OntologyTermSchema.nullable().optional(),
  spectral_library: z.string().trim().max(200).nullable().optional(),
  /** Quantities as typed, e.g. "24 h"; stored normalised to hours. */
  time_points: z.array(z.string()).max(50).optional(),
  description: z.string().max(10_000).optional(),
  /** Experiment-scope and sample-scope custom fields of this version (searchable flag drives search). */
  custom_fields: z.array(MetadataFieldDefSchema).max(200).optional(),
  /** Values of experiment-scope custom fields, validated by their type. */
  custom: z.record(z.string(), CustomValueSchema).optional(),
};

export const CreateExperimentBodySchema = z
  .strictObject({
    program_id: UuidV7Schema,
    assay_type: AssayTypeKeySchema,
    name: z.string().trim().min(1).max(200),
    ...VersionFieldsShape,
  })
  .meta({ id: 'CreateExperimentBody' });
export type CreateExperimentBody = z.infer<typeof CreateExperimentBodySchema>;

export const UpdateExperimentBodySchema = z
  .strictObject({ name: z.string().trim().min(1).max(200) })
  .meta({ id: 'UpdateExperimentBody' });

export const UpdateVersionBodySchema = z.strictObject(VersionFieldsShape).meta({ id: 'UpdateVersionBody' });
export type UpdateVersionBody = z.infer<typeof UpdateVersionBodySchema>;

export const PublishBodySchema = z
  .strictObject({ reason: z.string().trim().max(2000).optional() })
  .meta({ id: 'PublishBody' });

export const EXPERIMENT_SORTS = ['name', 'created_at', 'updated_at', 'experiment_date'] as const;

export const ListExperimentsQuerySchema = z
  .strictObject({
    assay_type: AssayTypeKeySchema.optional(),
    program_id: UuidV7Schema.optional(),
    date_from: DateSchema.optional(),
    date_to: DateSchema.optional(),
    name: z.string().max(200).optional(),
    q: z.string().max(200).optional(),
    status: z.enum(['draft', 'published', 'archived']).optional(),
    include_archived: z.enum(['true', 'false']).optional(),
    sort: z.enum(EXPERIMENT_SORTS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().max(500).optional(),
  })
  .meta({ id: 'ListExperimentsQuery' });
export type ListExperimentsQuery = z.infer<typeof ListExperimentsQuerySchema>;

export const VersionSummarySchema = z
  .object({
    id: z.uuid(),
    experiment_id: z.uuid(),
    version_number: z.int(),
    status: z.enum(['draft', 'published', 'archived']),
    parent_version_id: z.uuid().nullable(),
    experiment_date: DateSchema.nullable(),
    species: OntologyTermSchema.nullable(),
    spectral_library: z.string().nullable(),
    time_points: z.array(QuantitySchema),
    is_latest_published: z.boolean(),
    urn: z.string(),
    created_at: TimestampSchema,
    published_at: TimestampSchema.nullable(),
    publish_reason: z.string().nullable(),
  })
  .meta({ id: 'VersionSummary' });
export type VersionSummary = z.infer<typeof VersionSummarySchema>;

export const ExperimentListItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    urn: z.string(),
    assay_type: AssayTypeKeySchema,
    program_id: z.uuid(),
    program_code: z.string(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
    archived_at: TimestampSchema.nullable(),
    latest_published_version: z.int().nullable(),
    current_version: z.object({
      id: z.uuid(),
      version_number: z.int(),
      status: z.enum(['draft', 'published', 'archived']),
      parent_version_id: z.uuid().nullable(),
      experiment_date: DateSchema.nullable(),
      species: OntologyTermSchema.nullable(),
      spectral_library: z.string().nullable(),
      time_points: z.array(QuantitySchema),
    }),
  })
  .meta({ id: 'ExperimentListItem' });
export type ExperimentListItem = z.infer<typeof ExperimentListItemSchema>;

export const ExperimentListSchema = z
  .object({ items: z.array(ExperimentListItemSchema), next_cursor: z.string().nullable() })
  .meta({ id: 'ExperimentList' });

export const ExperimentDetailSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    urn: z.string(),
    assay_type: AssayTypeKeySchema,
    program_id: z.uuid(),
    program_code: z.string(),
    created_at: TimestampSchema,
    archived_at: TimestampSchema.nullable(),
    versions: z.array(VersionSummarySchema),
  })
  .meta({ id: 'ExperimentDetail' });
export type ExperimentDetail = z.infer<typeof ExperimentDetailSchema>;

export const ContrastInputSchema = z.strictObject({
  label: z.string().trim().min(1).max(300).optional(),
  numerator: z.string().trim().min(1).max(300),
  denominator: z.string().trim().min(1).max(300),
  method_hint: z.string().max(100).nullable().optional(),
});

export const ContrastRowSchema = z
  .object({
    id: z.uuid(),
    label: z.string(),
    numerator: z.string(),
    denominator: z.string(),
    method_hint: z.string().nullable(),
  })
  .meta({ id: 'ContrastRow' });

export const VersionDetailSchema = VersionSummarySchema.extend({
  experiment_name: z.string(),
  assay_type: AssayTypeKeySchema,
  program_id: z.uuid(),
  template_version: z.string(),
  description: z.string(),
  custom: z.record(z.string(), z.unknown()),
  custom_fields: z.array(MetadataFieldDefSchema),
  published_by: z.uuid().nullable(),
  sample_count: z.int(),
  contrasts: z.array(ContrastRowSchema),
}).meta({ id: 'VersionDetail' });
export type VersionDetail = z.infer<typeof VersionDetailSchema>;

export const SampleRowSchema = z
  .object({
    id: z.uuid(),
    sample_key: z.string(),
    source_name: z.string().nullable(),
    raw: z.record(z.string(), z.string()),
    characteristics: z.record(z.string(), z.unknown()),
    factors: z.record(z.string(), z.unknown()),
    technical: z.record(z.string(), z.unknown()),
    custom: z.record(z.string(), z.unknown()),
    validation_errors: z.record(z.string(), z.string()),
  })
  .meta({ id: 'SampleRow' });
export type SampleRow = z.infer<typeof SampleRowSchema>;

export const SampleListSchema = z.object({ items: z.array(SampleRowSchema) }).meta({ id: 'SampleList' });

export const UpsertSamplesBodySchema = z
  .strictObject({ rows: z.array(z.record(z.string(), z.string())).min(1).max(10_000) })
  .meta({ id: 'UpsertSamplesBody' });

export const DeleteSamplesBodySchema = z
  .strictObject({ sample_keys: z.array(z.string().min(1)).min(1).max(10_000) })
  .meta({ id: 'DeleteSamplesBody' });

export const SampleValidationSchema = z
  .object({ saved: z.int(), errors: z.array(ContractErrorSchema) })
  .meta({ id: 'SampleValidation' });

export const ReplaceContrastsBodySchema = z
  .strictObject({ contrasts: z.array(ContrastInputSchema).max(200) })
  .meta({ id: 'ReplaceContrastsBody' });

const FieldChangeSchema = z.object({ field: z.string(), before: z.unknown(), after: z.unknown() });

export const VersionDiffSchema = z
  .object({
    fields: z.array(FieldChangeSchema),
    custom: z.array(FieldChangeSchema),
    custom_fields: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
    samples: z.object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
      changed: z.array(z.object({ sample_key: z.string(), fields: z.array(FieldChangeSchema) })),
    }),
    contrasts: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
  })
  .meta({ id: 'VersionDiff' });
export type VersionDiff = z.infer<typeof VersionDiffSchema>;

export const ProgramRowSchema = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string(),
    requires_approval: z.boolean(),
  })
  .meta({ id: 'ProgramRow' });
export const ProgramListSchema = z.object({ items: z.array(ProgramRowSchema) }).meta({ id: 'ProgramList' });

export const TemplateSchema = z
  .object({
    assay_type: AssayTypeKeySchema,
    version: z.string(),
    status: z.enum(['draft', 'published', 'retired']),
    key_field: z.string(),
    fields: z.array(MetadataFieldDefSchema),
    built_in: z.boolean(),
  })
  .meta({ id: 'TemplateRow' });
export const ListTemplatesQuerySchema = z
  .strictObject({ assay_type: AssayTypeKeySchema.optional() })
  .meta({ id: 'ListTemplatesQuery' });

export const TemplateListSchema = z.object({ items: z.array(TemplateSchema) }).meta({ id: 'TemplateList' });

export const ItemsSchema = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
