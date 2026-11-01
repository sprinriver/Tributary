import type { ApiRoute } from './route.ts';
import {
  CreatedWebhookSchema,
  CreateWebhookBodySchema,
  WebhookDeliveryListSchema,
  WebhookDeliverySchema,
  WebhookListSchema,
} from './webhooks.ts';

/** Webhooks (SPEC M13). Part of API_ROUTES. */
export const WEBHOOK_ROUTES = {
  listWebhooks: {
    method: 'get',
    path: '/v1/admin/webhooks',
    summary: 'Webhook subscriptions (system admin; secrets are never listed)',
    response: WebhookListSchema,
  },
  createWebhook: {
    method: 'post',
    path: '/v1/admin/webhooks',
    summary: 'Subscribe an https endpoint to run-status events; returns the signing secret once',
    body: CreateWebhookBodySchema,
    response: CreatedWebhookSchema,
    status: 201,
    reason: true,
  },
  deleteWebhook: {
    method: 'delete',
    path: '/v1/admin/webhooks/{id}',
    summary: 'Stop and remove a subscription (soft delete)',
    status: 204,
    reason: true,
  },
  pingWebhook: {
    method: 'post',
    path: '/v1/admin/webhooks/{id}/ping',
    summary: 'Send a signed ping and record the delivery',
    response: WebhookDeliverySchema,
    reason: true,
  },
  listWebhookDeliveries: {
    method: 'get',
    path: '/v1/admin/webhooks/{id}/deliveries',
    summary: 'The latest 50 deliveries of a subscription',
    response: WebhookDeliveryListSchema,
  },
} as const satisfies Record<string, ApiRoute>;
