import { z } from 'zod';

/** Programs (SPEC M11): codes are short, upper-case and unique. */
export const CreateProgramBodySchema = z
  .strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_-]{1,15}$/, 'Upper-case letters, digits, - or _ (2–16 characters)'),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    requires_approval: z.boolean().optional(),
  })
  .meta({ id: 'CreateProgramBody' });
export const UpdateProgramBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    requires_approval: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Change at least one field' })
  .meta({ id: 'UpdateProgramBody' });

export const PICKLIST_KINDS = ['species', 'spectral_library', 'time_point'] as const;
export const PicklistKindSchema = z.enum(PICKLIST_KINDS);
export type PicklistKind = z.infer<typeof PicklistKindSchema>;
export const PicklistValueSchema = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(200),
});
export const PicklistSchema = z
  .object({
    kind: PicklistKindSchema,
    /** True while an admin has not set this list (the product's defaults are shown). */
    built_in: z.boolean(),
    values: z.array(PicklistValueSchema),
  })
  .meta({ id: 'Picklist' });
export type Picklist = z.infer<typeof PicklistSchema>;
export const PicklistQuerySchema = z.object({ kind: PicklistKindSchema }).meta({ id: 'PicklistQuery' });
export const PutPicklistBodySchema = z
  .strictObject({ values: z.array(PicklistValueSchema).max(200) })
  .meta({ id: 'PutPicklistBody' });

export const OntologySourcesSchema = z
  .object({
    /** The lookup service (OLS4) the API calls; set by the deployment. */
    ols_url: z.string(),
    sources: z.array(z.object({ prefix: z.string(), label: z.string(), enabled: z.boolean() })),
  })
  .meta({ id: 'OntologySources' });
export type OntologySources = z.infer<typeof OntologySourcesSchema>;
export const PutOntologySourcesBodySchema = z
  .strictObject({ enabled: z.array(z.string().min(1).max(50)).max(50) })
  .meta({ id: 'PutOntologySourcesBody' });

export const GroupMappingSchema = z
  .strictObject({
    group: z.string().trim().min(1).max(200),
    role: z.enum(['viewer', 'contributor', 'approver', 'admin', 'system_admin']),
    /** Program codes, or "*" for all programs; ignored for system_admin. */
    programs: z.array(z.string().min(1).max(50)).max(100),
  })
  .meta({ id: 'GroupMapping' });
export type GroupMapping = z.infer<typeof GroupMappingSchema>;
export const GroupMappingsSchema = z
  .object({
    items: z.array(GroupMappingSchema),
    /** Mappings from AUTH_GROUP_ROLE_MAP (deployment configuration; read-only here). */
    from_config: z.array(GroupMappingSchema),
  })
  .meta({ id: 'GroupMappings' });
export const PutGroupMappingsBodySchema = z
  .strictObject({ items: z.array(GroupMappingSchema).max(200) })
  .meta({ id: 'PutGroupMappingsBody' });

export const HealthStatusLevelSchema = z.enum(['ok', 'degraded', 'down']);
export const HealthReportSchema = z
  .object({
    status: HealthStatusLevelSchema,
    checked_at: z.string(),
    checks: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        status: HealthStatusLevelSchema,
        detail: z.string(),
        latency_ms: z.number().nullable(),
      }),
    ),
    runners: z.array(z.object({ kind: z.string(), configured: z.boolean(), detail: z.string() })),
    ai: z.object({ enabled: z.boolean(), provider: z.string() }),
  })
  .meta({ id: 'HealthReport' });
export type HealthReport = z.infer<typeof HealthReportSchema>;
