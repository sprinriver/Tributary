// Team notification routes (Phase 31, NOTIF-01/03). System admins only; every change is audited without the URL.
import {
  CreateNotificationRouteBodySchema,
  NotificationDeliveryListSchema,
  NotificationDeliverySchema,
  NotificationRouteListSchema,
  NotificationRouteSchema,
  UpdateNotificationRouteBodySchema,
  type NotificationRoute,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requireSystemAdmin } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { checkWebhookHost, urlHint } from '../notifications/hosts.ts';
import { post } from '../notifications/sweep.ts';
import { respond } from '../respond.ts';
import { assertPublicDestination } from '../webhooks/address.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);

export function registerNotificationRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  const { db, config } = deps;

  const routes = (tenantId: string) =>
    db
      .selectFrom('notification_route as r')
      .leftJoin('program as p', 'p.id', 'r.program_id')
      .select([
        'r.id',
        'r.name',
        'r.kind',
        'r.url',
        'r.program_id',
        'p.code as program_code',
        'r.events',
        'r.active',
        'r.created_at',
      ])
      .where('r.tenant_id', '=', tenantId)
      .where('r.deleted_at', 'is', null);
  type Row = Awaited<ReturnType<ReturnType<typeof routes>['executeTakeFirstOrThrow']>>;
  const view = ({ url, created_at, ...r }: Row): NotificationRoute => ({
    ...r,
    kind: r.kind as NotificationRoute['kind'],
    events: r.events as NotificationRoute['events'],
    url_hint: urlHint(url),
    created_at: iso(created_at),
  });
  /** What the audit log keeps of a route: never the URL (it is the secret). */
  const audited = (r: {
    name: string;
    kind: string;
    url: string;
    program_id: string | null;
    events: string[];
    active: boolean;
  }) => ({
    name: r.name,
    kind: r.kind,
    url_hint: urlHint(r.url),
    program_id: r.program_id,
    events: r.events,
    active: r.active,
  });
  const one = async (tenantId: string, id: string) => {
    const row = await routes(tenantId).where('r.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Notification route');
    return row;
  };

  app.get('/v1/notification-routes', async (request) => {
    const admin = requireSystemAdmin(request);
    const rows = await routes(admin.tenantId).orderBy('r.created_at').execute();
    return respond(NotificationRouteListSchema, { items: rows.map(view) });
  });

  app.post('/v1/notification-routes', async (request, reply) => {
    requireSystemAdmin(request);
    const body = parse(CreateNotificationRouteBodySchema, request.body);
    checkWebhookHost(body.kind, body.url, config.notifyExtraHosts);
    if (config.production)
      await assertPublicDestination(body.url).catch(() => {
        throw new HttpError(
          422,
          'unsupported_webhook_host',
          'The webhook host resolves to a private address.',
          'url',
        );
      });
    const actor = requestActor(request);
    const id = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('notification_route')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          name: body.name,
          kind: body.kind,
          url: body.url,
          program_id: body.program_id ?? null,
          events: body.events,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await insertAudit(trx, actor, {
        action: 'notification_route.create',
        entityType: 'notification_route',
        entityId: row.id,
        after: audited(row),
      });
      return row.id;
    });
    reply.code(201);
    return respond(NotificationRouteSchema, view(await one(actor.tenantId, id)));
  });

  app.patch('/v1/notification-routes/:id', async (request: IdParams) => {
    requireSystemAdmin(request);
    const body = parse(UpdateNotificationRouteBodySchema, request.body);
    const actor = requestActor(request);
    const before = await one(actor.tenantId, request.params.id);
    await db.transaction().execute(async (trx) => {
      const after = await trx
        .updateTable('notification_route')
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.events !== undefined ? { events: body.events } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        })
        .where('id', '=', before.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await insertAudit(trx, actor, {
        action: 'notification_route.update',
        entityType: 'notification_route',
        entityId: before.id,
        before: audited(before),
        after: audited(after),
      });
    });
    return respond(NotificationRouteSchema, view(await one(actor.tenantId, before.id)));
  });

  app.delete('/v1/notification-routes/:id', async (request: IdParams, reply) => {
    requireSystemAdmin(request);
    const actor = requestActor(request);
    const before = await one(actor.tenantId, request.params.id);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('notification_route')
        .set({ deleted_at: new Date() })
        .where('id', '=', before.id)
        .execute();
      await insertAudit(trx, actor, {
        action: 'notification_route.delete',
        entityType: 'notification_route',
        entityId: before.id,
        before: audited(before),
      });
    });
    return reply.code(204).send();
  });

  const deliveryColumns = [
    'id',
    'event',
    'title',
    'status',
    'attempts',
    'error',
    'created_at',
    'delivered_at',
  ] as const;
  const deliveryView = (d: {
    id: string;
    event: string;
    title: string;
    status: string;
    attempts: number;
    error: string | null;
    created_at: Date;
    delivered_at: Date | null;
  }) => ({
    ...d,
    // 'sending' is internal: to a reader it is still pending.
    status: (d.status === 'sending' ? 'pending' : d.status) as 'pending' | 'delivered' | 'failed',
    created_at: iso(d.created_at),
    delivered_at: d.delivered_at ? iso(d.delivered_at) : null,
  });

  app.post('/v1/notification-routes/:id/test', async (request: IdParams) => {
    requireSystemAdmin(request);
    const actor = requestActor(request);
    const route = await one(actor.tenantId, request.params.id);
    const message = {
      title: 'Tributary test message',
      lines: [`This channel will receive: ${route.events.join(', ')}.`],
      url: config.publicUrl,
    };
    const error = await post(deps, route, message);
    const row = await db
      .insertInto('notification_delivery')
      .values({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        route_id: route.id,
        event: 'test',
        title: message.title,
        message: JSON.stringify(message),
        status: error ? 'failed' : 'delivered',
        attempts: 1,
        error,
        delivered_at: error ? null : new Date(),
      })
      .returning([...deliveryColumns])
      .executeTakeFirstOrThrow();
    return respond(NotificationDeliverySchema, deliveryView(row));
  });

  app.get('/v1/notification-routes/:id/deliveries', async (request: IdParams) => {
    requireSystemAdmin(request);
    const route = await one(requestActor(request).tenantId, request.params.id);
    const rows = await db
      .selectFrom('notification_delivery')
      .select([...deliveryColumns])
      .where('route_id', '=', route.id)
      .orderBy('id', 'desc')
      .limit(100)
      .execute();
    return respond(NotificationDeliveryListSchema, { items: rows.map(deliveryView) });
  });
}
