import { z } from 'zod';
import { AssayTypeKeySchema, MetadataFieldDefSchema, MetadataTemplateDefinitionSchema } from '../template.ts';

/** How many experiment versions pin a template version, by version status. */
export const PinnedCountsSchema = z.object({ draft: z.int(), published: z.int(), archived: z.int() });

export const AdminTemplateSchema = MetadataTemplateDefinitionSchema.extend({
  /** The template shipped with the product (used until an admin stores one for this assay type). */
  built_in: z.boolean(),
  pinned: PinnedCountsSchema,
}).meta({ id: 'AdminTemplate' });
export type AdminTemplate = z.infer<typeof AdminTemplateSchema>;

export const AdminTemplateListQuerySchema = z
  .object({ assay_type: AssayTypeKeySchema })
  .meta({ id: 'AdminTemplateListQuery' });
export const AdminTemplateListSchema = z
  .object({ items: z.array(AdminTemplateSchema) })
  .meta({ id: 'AdminTemplateList' });

/** A new template version (SPEC M11): the full field list; the version number is the next major/minor/patch. */
export const CreateTemplateBodySchema = z
  .strictObject({
    assay_type: AssayTypeKeySchema,
    bump: z.enum(['major', 'minor', 'patch']),
    fields: z.array(MetadataFieldDefSchema).min(1).max(200),
    key_field: z.string().optional(),
  })
  .meta({ id: 'CreateTemplateBody' });
export type CreateTemplateBody = z.infer<typeof CreateTemplateBodySchema>;

/** What changes for users if this version is published (migration preview). */
export const TemplatePreviewSchema = z
  .object({
    assay_type: AssayTypeKeySchema,
    version: z.string(),
    /** The version new experiments pin today. */
    base_version: z.string(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(z.string()),
    /** Fields new drafts will have to fill that they did not have to before. */
    newly_required: z.array(z.string()),
    /** Existing experiment versions keep their pinned template; counts per version. */
    pinned: z.array(PinnedCountsSchema.extend({ version: z.string() })),
  })
  .meta({ id: 'TemplatePreview' });
export type TemplatePreview = z.infer<typeof TemplatePreviewSchema>;

export const PublishTemplateBodySchema = z
  .strictObject({ reason: z.string().trim().min(1).max(1000) })
  .meta({ id: 'PublishTemplateBody' });
