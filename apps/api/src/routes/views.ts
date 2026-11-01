import { CreateViewBodySchema, ViewListSchema, ViewSchema, type View } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { authorize, readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);

function base(db: Database) {
  return db
    .selectFrom('saved_view as v')
    .leftJoin('app_user as u', 'u.id', 'v.owner')
    .select([
      'v.id',
      'v.name',
      'v.owner',
      'u.name as owner_name',
      'v.program_id',
      'v.visibility',
      'v.query_spec',
      'v.chart_spec',
      'v.created_at',
      'v.updated_at',
    ])
    .where('v.deleted_at', 'is', null);
}
type Row = Awaited<ReturnType<ReturnType<typeof base>['executeTakeFirstOrThrow']>>;

const toView = (r: Row): View => ({
  ...r,
  visibility: r.visibility as View['visibility'],
  query_spec: r.query_spec as View['query_spec'],
  chart_spec: (r.chart_spec ?? null) as View['chart_spec'],
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});

/** Views the caller may open: their own, and program views of programs they can read. */
function visible(db: Database, request: FastifyRequest) {
  const principal = requirePrincipal(request);
  const programs = readablePrograms(principal);
  return base(db).where((eb) =>
    eb.or([
      eb('v.owner', '=', principal.userId),
      ...(programs === null
        ? [eb('v.visibility', '=', 'program')]
        : programs.length
          ? [eb.and([eb('v.visibility', '=', 'program'), eb('v.program_id', 'in', programs)])]
          : []),
    ]),
  );
}

/** A view the caller may open, or undefined (charts read views through this too). */
export async function visibleView(
  db: Database,
  request: FastifyRequest,
  id: string,
): Promise<View | undefined> {
  const row = await visible(db, request).where('v.id', '=', id).executeTakeFirst();
  return row ? toView(row) : undefined;
}

/** Saved views (SPEC M6). Someone without access gets 404, so links never reveal that a view exists. */
export function registerViewRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/views', async (request) =>
    respond(ViewListSchema, {
      items: (await visible(db, request).orderBy('v.created_at', 'desc').limit(200).execute()).map(toView),
    }),
  );

  app.get('/v1/views/:id', async (request: IdParams) => {
    const row = await visible(db, request).where('v.id', '=', request.params.id).executeTakeFirst();
    if (!row) throw notFound('View');
    return respond(ViewSchema, toView(row));
  });

  app.post('/v1/views', async (request, reply) => {
    const body = parse(CreateViewBodySchema, request.body);
    const principal = requirePrincipal(request);
    if (body.visibility === 'program') authorize(request, 'create', 'SavedView', body.program_id!);
    const actor = requestActor(request);
    const id = await db.transaction().execute(async (trx) => {
      const { id } = await trx
        .insertInto('saved_view')
        .values({
          tenant_id: principal.tenantId,
          created_by: principal.userId,
          owner: principal.userId,
          name: body.name,
          program_id: body.visibility === 'program' ? body.program_id! : null,
          visibility: body.visibility,
          query_spec: JSON.stringify(body.query_spec),
          chart_spec: body.chart_spec ? JSON.stringify(body.chart_spec) : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await insertAudit(trx, actor, {
        action: 'view.create',
        entityType: 'saved_view',
        entityId: id,
        after: body,
      });
      return id;
    });
    reply.code(201);
    return respond(ViewSchema, toView(await base(db).where('v.id', '=', id).executeTakeFirstOrThrow()));
  });

  app.delete('/v1/views/:id', async (request: IdParams, reply) => {
    const principal = requirePrincipal(request);
    const row = await base(db)
      .where('v.id', '=', request.params.id)
      .where('v.owner', '=', principal.userId)
      .executeTakeFirst();
    if (!row) throw notFound('View');
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('saved_view').set({ deleted_at: new Date() }).where('id', '=', row.id).execute();
      await insertAudit(trx, requestActor(request), {
        action: 'view.delete',
        entityType: 'saved_view',
        entityId: row.id,
        before: toView(row),
      });
    });
    return reply.code(204).send();
  });
}
