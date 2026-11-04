import { z } from 'zod';

// Team notifications (Phase 31, NOTIF-01…04): events posted to Slack or Microsoft Teams channels through their
// incoming-webhook URLs. Messages carry names, statuses and links only, never data values.

export const NOTIFICATION_EVENTS = [
  'run.finished',
  'version.published',
  'release.published',
  'triage.decision',
] as const;
export const NotificationEventSchema = z.enum(NOTIFICATION_EVENTS);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;
export const NotificationKindSchema = z.enum(['slack', 'teams']);

export const CreateNotificationRouteBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    kind: NotificationKindSchema,
    /** The channel's incoming-webhook URL (secret: never shown again). */
    url: z.url({ protocol: /^https$/ }).max(2000),
    /** Only this program's events; omitted = every program. */
    program_id: z.uuid().optional(),
    events: z.array(NotificationEventSchema).min(1),
  })
  .meta({ id: 'CreateNotificationRouteBody' });

export const UpdateNotificationRouteBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    events: z.array(NotificationEventSchema).min(1).optional(),
    active: z.boolean().optional(),
  })
  .meta({ id: 'UpdateNotificationRouteBody' });

export const NotificationRouteSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: NotificationKindSchema,
    /** Scheme and host only, e.g. "https://hooks.slack.com/…". */
    url_hint: z.string(),
    program_id: z.uuid().nullable(),
    program_code: z.string().nullable(),
    events: z.array(NotificationEventSchema),
    active: z.boolean(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'NotificationRoute' });
export type NotificationRoute = z.infer<typeof NotificationRouteSchema>;
export const NotificationRouteListSchema = z
  .object({ items: z.array(NotificationRouteSchema) })
  .meta({ id: 'NotificationRouteList' });

export const NotificationDeliverySchema = z
  .object({
    id: z.uuid(),
    event: z.string(),
    title: z.string(),
    status: z.enum(['pending', 'delivered', 'failed']),
    attempts: z.int(),
    error: z.string().nullable(),
    created_at: z.iso.datetime({ offset: true }),
    delivered_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'NotificationDelivery' });
export const NotificationDeliveryListSchema = z
  .object({ items: z.array(NotificationDeliverySchema) })
  .meta({ id: 'NotificationDeliveryList' });
