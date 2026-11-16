// Watchlists and alerts (Phase 26, WAT-01/03): personal; other people's watches and alerts are "not found".
import {
  AlertListSchema,
  AlertSchema,
  CreateWatchBodySchema,
  ListAlertsQuerySchema,
  WatchListSchema,
  WatchSchema,
  type Alert,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requirePrincipal } from '../auth/plugin.ts';
import { notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;
const iso = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.toISOString() : v);

function alerts(db: Database, userId: string) {
  return db
    .selectFrom('alert as a')
    .innerJoin('watch as w', 'w.id', 'a.watch_id')
    .innerJoin('dataset_release as r', 'r.id', 'a.release_id')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .innerJoin('program as p', 'p.id', 'd.program_id')
    .leftJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
    .leftJoin('experiment as e', 'e.id', 'v.experiment_id')
    .select([
      'a.id',
      'w.id as watch_id',
      'w.kind',
      'w.key',
      'w.label',
      'a.release_id',
      'd.name as dataset_name',
      'p.code as program_code',
      'e.id as experiment_id',
      'e.name as experiment_name',
      'a.contrast_label',
      'a.log2_fc',
      'a.adj_p_value',
      'a.rule',
      'a.created_at',
      'a.read_at',
    ])
    .where('a.user_id', '=', userId)
    .where('a.deleted_at', 'is', null);
}
type AlertRow = Awaited<ReturnType<ReturnType<typeof alerts>['executeTakeFirstOrThrow']>>;
const toAlert = (r: AlertRow): Alert => ({
  id: r.id,
  watch: { id: r.watch_id, kind: r.kind as Alert['watch']['kind'], key: r.key, label: r.label },
  release_id: r.release_id,
  dataset_name: r.dataset_name,
  program_code: r.program_code,
  experiment_id: r.experiment_id,
  experiment_name: r.experiment_name,
  contrast_label: r.contrast_label || null,
  log2_fc: r.log2_fc,
  adj_p_value: r.adj_p_value,
  rule: r.rule,
  created_at: iso(r.created_at)!,
  read_at: iso(r.read_at),
});

async function alertList(db: Database, userId: string, unreadOnly: boolean) {
  let q = alerts(db, userId);
  if (unreadOnly) q = q.where('a.read_at', 'is', null);
  const items = (await q.orderBy('a.id', 'desc').limit(200).execute()).map(toAlert);
  const unread = await db
    .selectFrom('alert')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('user_id', '=', userId)
    .where('read_at', 'is', null)
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return { items, unread: Number(unread.n) };
}

export function registerWatchRoutes(app: FastifyInstance, db: Database): void {
  const watches = (userId: string) =>
    db
      .selectFrom('watch')
      .select(['id', 'kind', 'key', 'label', 'created_at'])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);
  const toWatch = (w: { id: string; kind: string; key: string; label: string | null; created_at: Date }) => ({
    ...w,
    kind: w.kind as 'protein' | 'gene' | 'compound',
    created_at: w.created_at.toISOString(),
  });

  app.get('/v1/watches', async (request) => {
    const principal = requirePrincipal(request);
    const rows = await watches(principal.userId).orderBy('created_at', 'desc').execute();
    return respond(WatchListSchema, { items: rows.map(toWatch) });
  });

  app.post('/v1/watches', async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(CreateWatchBodySchema, request.body);
    const existing = await watches(principal.userId)
      .where('kind', '=', body.kind)
      .where('key', '=', body.key)
      .executeTakeFirst();
    if (existing) return respond(WatchSchema, toWatch(existing));
    const actor = requestActor(request);
    const created = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('watch')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          user_id: actor.userId,
          kind: body.kind,
          key: body.key,
          label: body.label ?? null,
        })
        .returning(['id', 'kind', 'key', 'label', 'created_at'])
        .executeTakeFirstOrThrow();
      await insertAudit(trx, actor, {
        action: 'watch.create',
        entityType: 'watch',
        entityId: row.id,
        after: row,
      });
      return row;
    });
    reply.code(201);
    return respond(WatchSchema, toWatch(created));
  });

  app.delete('/v1/watches/:id', async (request: IdParams, reply) => {
    const principal = requirePrincipal(request);
    const row = await watches(principal.userId).where('id', '=', request.params.id).executeTakeFirst();
    if (!row) throw notFound('Watch');
    const actor = requestActor(request);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('watch').set({ deleted_at: new Date() }).where('id', '=', row.id).execute();
      await insertAudit(trx, actor, {
        action: 'watch.delete',
        entityType: 'watch',
        entityId: row.id,
        before: row,
      });
    });
    return reply.status(204).send();
  });

  app.get('/v1/alerts', async (request) => {
    const principal = requirePrincipal(request);
    const query = parse(ListAlertsQuerySchema, request.query);
    return respond(AlertListSchema, await alertList(db, principal.userId, query.unread_only === 'true'));
  });

  app.post('/v1/alerts/read-all', async (request) => {
    const principal = requirePrincipal(request);
    const actor = requestActor(request);
    await db.transaction().execute(async (trx) => {
      const read = await trx
        .updateTable('alert')
        .set({ read_at: new Date() })
        .where('user_id', '=', principal.userId)
        .where('read_at', 'is', null)
        .returning('id')
        .execute();
      if (read.length)
        await insertAudit(trx, actor, {
          action: 'alert.read_all',
          entityType: 'app_user',
          entityId: principal.userId,
          after: { alerts: read.length },
        });
    });
    return respond(AlertListSchema, await alertList(db, principal.userId, false));
  });

  app.post('/v1/alerts/:id/read', async (request: IdParams) => {
    const principal = requirePrincipal(request);
    const row = await alerts(db, principal.userId).where('a.id', '=', request.params.id).executeTakeFirst();
    if (!row) throw notFound('Alert');
    if (row.read_at === null) {
      const actor = requestActor(request);
      await db.transaction().execute(async (trx) => {
        await trx.updateTable('alert').set({ read_at: new Date() }).where('id', '=', row.id).execute();
        await insertAudit(trx, actor, { action: 'alert.read', entityType: 'alert', entityId: row.id });
      });
    }
    const fresh = await alerts(db, principal.userId).where('a.id', '=', row.id).executeTakeFirstOrThrow();
    return respond(AlertSchema, toAlert(fresh));
  });
}
