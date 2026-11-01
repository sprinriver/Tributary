import { z } from 'zod';

/** Webhooks (SPEC M13; v2.0: run status only). */
export const WEBHOOK_EVENTS = ['run.status'] as const;
export const WebhookEventSchema = z.enum(WEBHOOK_EVENTS);

export const CreateWebhookBodySchema = z
  .strictObject({
    url: z.url().max(2000),
    description: z.string().max(500).optional(),
    events: z.array(WebhookEventSchema).min(1),
  })
  .meta({ id: 'CreateWebhookBody' });

export const WebhookSchema = z
  .object({
    id: z.uuid(),
    url: z.string(),
    description: z.string(),
    events: z.array(WebhookEventSchema),
    active: z.boolean(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Webhook' });
export type Webhook = z.infer<typeof WebhookSchema>;

/** Returned once, at creation: the signing secret is never shown again. */
export const CreatedWebhookSchema = WebhookSchema.extend({ secret: z.string() }).meta({
  id: 'CreatedWebhook',
});
export const WebhookListSchema = z.object({ items: z.array(WebhookSchema) }).meta({ id: 'WebhookList' });

export const WebhookDeliverySchema = z
  .object({
    id: z.uuid(),
    event: z.string(),
    status: z.enum(['pending', 'delivered', 'failed']),
    attempts: z.int(),
    response_status: z.int().nullable(),
    error: z.string().nullable(),
    created_at: z.iso.datetime({ offset: true }),
    delivered_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'WebhookDelivery' });
export const WebhookDeliveryListSchema = z
  .object({ items: z.array(WebhookDeliverySchema) })
  .meta({ id: 'WebhookDeliveryList' });

/** The body of every delivery; `X-Tributary-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`. */
export const WebhookPayloadSchema = z
  .object({
    id: z.uuid(),
    event: z.union([WebhookEventSchema, z.literal('ping')]),
    created_at: z.iso.datetime({ offset: true }),
    data: z.record(z.string(), z.unknown()),
  })
  .meta({ id: 'WebhookPayload' });
