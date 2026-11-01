import {
  CreatedWebhookSchema,
  CreateWebhookBodySchema,
  WebhookDeliveryListSchema,
  WebhookDeliverySchema,
  WebhookListSchema,
  type Webhook,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requireSystemAdmin } from '../auth/plugin.ts';
import { randomToken } from '../auth/crypto.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { assertPublicDestination } from '../webhooks/address.ts';
import { deliver, type DeliveryRow } from '../webhooks/dispatch.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

const toWebhook = (r: {
  id: string;
  url: string;
  description: string;
  events: string[];
  active: boolean;
  created_at: Date;
}): Webhook => ({ ...r, events: r.events as Webhook['events'], created_at: r.created_at.toISOString() });

const toDelivery = (d: DeliveryRow) => ({
  ...d,
  created_at: d.created_at.toISOString(),
  delivered_at: d.delivered_at?.toISOString() ?? null,
});

/** https only (plain http only to localhost outside production); in production, public addresses only. */
async function checkUrl(url: string, production: boolean): Promise<void> {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local && !production)))
    throw new HttpError(400, 'invalid_url', 'Webhook URLs must use https.', 'url');
  if (production)
    await assertPublicDestination(url).catch(() => {
      throw new HttpError(400, 'invalid_url', 'Webhook URLs must resolve to public addresses.', 'url');
    });
}

/** Webhook subscriptions (SPEC M13), system admins only. Every change is audited; secrets are shown once. */
export function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  const { db, config } = deps;
  const columns = ['id', 'url', 'description', 'events', 'active', 'created_at'] as const;
  const own = async (tenantId: string, id: string) => {
    const row = await db
      .selectFrom('webhook_subscription')
      .select([...columns, 'secret', 'created_by'])
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('Webhook');
    return row;
  };

  app.get('/v1/admin/webhooks', async (request) => {
    const principal = requireSystemAdmin(request);
    const rows = await db
      .selectFrom('webhook_subscription')
      .select([...columns])
      .where('tenant_id', '=', principal.tenantId)
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .execute();
    return respond(WebhookListSchema, { items: rows.map(toWebhook) });
  });

  app.post('/v1/admin/webhooks', async (request, reply) => {
    const principal = requireSystemAdmin(request);
    const body = parse(CreateWebhookBodySchema, request.body);
    await checkUrl(body.url, config.production);
    const secret = `whsec_${randomToken(32)}`;
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('webhook_subscription')
        .values({
          tenant_id: principal.tenantId,
          created_by: principal.userId,
          url: body.url,
          description: body.description ?? '',
          events: [...new Set(body.events)],
          secret,
        })
        .returning([...columns])
        .executeTakeFirstOrThrow();
      await insertAudit(trx, requestActor(request), {
        action: 'webhook.create',
        entityType: 'webhook_subscription',
        entityId: created.id,
        after: { url: created.url, events: created.events },
      });
      return created;
    });
    reply.code(201);
    return respond(CreatedWebhookSchema, { ...toWebhook(row), secret });
  });

  app.delete('/v1/admin/webhooks/:id', async (request: IdParams, reply) => {
    const principal = requireSystemAdmin(request);
    const row = await own(principal.tenantId, request.params.id);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('webhook_subscription')
        .set({ active: false, deleted_at: new Date() })
        .where('id', '=', row.id)
        .execute();
      await insertAudit(trx, requestActor(request), {
        action: 'webhook.delete',
        entityType: 'webhook_subscription',
        entityId: row.id,
        before: { url: row.url, events: row.events },
      });
    });
    return reply.code(204).send();
  });

  app.post('/v1/admin/webhooks/:id/ping', async (request: IdParams) => {
    const principal = requireSystemAdmin(request);
    const sub = await own(principal.tenantId, request.params.id);
    const delivery = await deliver(
      { db, fetch: deps.fetch, tenantId: principal.tenantId, production: config.production },
      sub,
      'ping',
      {
        message: 'Tributary webhook test',
      },
    );
    await insertAudit(db, requestActor(request), {
      action: 'webhook.ping',
      entityType: 'webhook_subscription',
      entityId: sub.id,
      after: { status: delivery.status, response_status: delivery.response_status },
    });
    return respond(WebhookDeliverySchema, toDelivery(delivery));
  });

  app.get('/v1/admin/webhooks/:id/deliveries', async (request: IdParams) => {
    const principal = requireSystemAdmin(request);
    const sub = await own(principal.tenantId, request.params.id);
    const rows = await db
      .selectFrom('webhook_delivery')
      .select(['id', 'event', 'status', 'attempts', 'response_status', 'error', 'created_at', 'delivered_at'])
      .where('subscription_id', '=', sub.id)
      .orderBy('id', 'desc')
      .limit(50)
      .execute();
    return respond(WebhookDeliveryListSchema, { items: (rows as DeliveryRow[]).map(toDelivery) });
  });
}
