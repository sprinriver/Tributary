import { z } from 'zod';
import {
  BaseEntityShape,
  DateSchema,
  ExperimentUrnSchema,
  ExperimentVersionUrnSchema,
  JsonObjectSchema,
  OntologyTermSchema,
  SemverSchema,
  TimestampSchema,
  UuidV7Schema,
} from '../common.ts';
import { QuantitySchema } from '../quantity.ts';
import { AssayTypeKeySchema, MetadataFieldDefSchema } from '../template.ts';

// SPEC §4 — registry entities (programs, experiments, versions, samples, contrasts).

export const ProgramSchema = z
  .object({ ...BaseEntityShape, name: z.string().min(1), code: z.string().min(1), description: z.string() })
  .meta({ id: 'Program' });
export type Program = z.infer<typeof ProgramSchema>;

export const AssayTypeSchema = z
  .object({
    ...BaseEntityShape,
    key: AssayTypeKeySchema,
    label: z.string().min(1),
    family: z.enum(['proteomics', 'genomics']),
    enabled: z.boolean(),
  })
  .meta({ id: 'AssayType' });
export type AssayType = z.infer<typeof AssayTypeSchema>;

/** A custom field attached to one experiment version (template fields are shared). */
export const CustomFieldDefSchema = z
  .object({ ...BaseEntityShape, experiment_version_id: UuidV7Schema, field: MetadataFieldDefSchema })
  .meta({ id: 'CustomFieldDef' });

export const ExperimentSchema = z
  .object({
    ...BaseEntityShape,
    program_id: UuidV7Schema,
    assay_type: AssayTypeKeySchema,
    name: z.string().min(1),
    urn: ExperimentUrnSchema,
  })
  .meta({ id: 'Experiment' });
export type Experiment = z.infer<typeof ExperimentSchema>;

export const ExperimentVersionStatusSchema = z.enum(['draft', 'published', 'archived']);

export const ExperimentVersionSchema = z
  .object({
    ...BaseEntityShape,
    experiment_id: UuidV7Schema,
    version_number: z.int().positive(),
    parent_version_id: UuidV7Schema.nullable(),
    status: ExperimentVersionStatusSchema,
    template_version: SemverSchema,
    experiment_date: DateSchema.nullable(),
    species: OntologyTermSchema.nullable(),
    spectral_library: z.string().nullable(),
    time_points: z.array(QuantitySchema),
    description: z.string(),
    custom: JsonObjectSchema,
    publish_reason: z.string().min(1).nullable(),
    published_by: UuidV7Schema.nullable(),
    published_at: TimestampSchema.nullable(),
    urn: ExperimentVersionUrnSchema,
  })
  .superRefine((v, ctx) => {
    if (v.status === 'draft') return;
    for (const key of ['publish_reason', 'published_by', 'published_at'] as const) {
      if (v[key] === null) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `A ${v.status} version needs ${key}.`,
          params: { code: 'required' },
        });
      }
    }
  })
  .meta({ id: 'ExperimentVersion' });
export type ExperimentVersion = z.infer<typeof ExperimentVersionSchema>;

export const SampleSchema = z
  .object({
    ...BaseEntityShape,
    experiment_version_id: UuidV7Schema,
    sample_key: z.string().min(1),
    source_name: z.string().nullable(),
    characteristics: JsonObjectSchema,
    factors: JsonObjectSchema,
    technical: JsonObjectSchema,
    custom: JsonObjectSchema,
    /** Per-cell validation errors, keyed by column. */
    validation_errors: z.record(z.string(), z.string()),
  })
  .meta({ id: 'Sample' });
export type Sample = z.infer<typeof SampleSchema>;

export const SampleFileSchema = z
  .object({
    ...BaseEntityShape,
    sample_id: UuidV7Schema,
    file_id: UuidV7Schema,
    role: z.enum(['raw', 'processed', 'other']),
  })
  .meta({ id: 'SampleFile' });

/** Analysis design, separate from samples. Label reads "numerator vs denominator"; log2FC = log2(num / den). */
export const ContrastSchema = z
  .object({
    ...BaseEntityShape,
    experiment_version_id: UuidV7Schema,
    label: z.string().min(1),
    numerator: z.string().min(1),
    denominator: z.string().min(1),
    method_hint: z.string().nullable(),
  })
  .meta({ id: 'Contrast' });
export type Contrast = z.infer<typeof ContrastSchema>;
