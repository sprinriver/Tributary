import { z } from 'zod';

/** Filters shared by the audit list and its CSV export (SPEC M10). */
export const AuditFilterSchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  entity_type: z.string().trim().min(1).max(100).optional(),
  entity_id: z.uuid().optional(),
  actor_id: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

export const AuditQuerySchema = AuditFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
}).meta({ id: 'AuditQuery' });
export type AuditQuery = z.input<typeof AuditQuerySchema>;

export const AuditExportQuerySchema = AuditFilterSchema.meta({ id: 'AuditExportQuery' });
export type AuditExportQuery = z.input<typeof AuditExportQuerySchema>;

export const AuditEntrySchema = z
  .object({
    id: z.uuid(),
    at: z.string(),
    actor_id: z.uuid(),
    actor_name: z.string().nullable(),
    actor_type: z.string(),
    action: z.string(),
    entity_type: z.string(),
    entity_id: z.uuid(),
    reason: z.string().nullable(),
    request_id: z.string(),
    before: z.unknown(),
    after: z.unknown(),
  })
  .meta({ id: 'AuditEntry' });
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditListSchema = z
  .object({ items: z.array(AuditEntrySchema), next_cursor: z.string().nullable() })
  .meta({ id: 'AuditList' });
export type AuditList = z.infer<typeof AuditListSchema>;

/** Entities with a history tab (GET /v1/history/{type}/{id}). */
export const HISTORY_TYPES = [
  'experiment',
  'experiment_version',
  'dataset_release',
  'file',
  'pipeline_run',
] as const;
export const HistoryParamsSchema = z.object({ type: z.enum(HISTORY_TYPES), id: z.uuid() });
