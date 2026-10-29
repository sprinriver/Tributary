import { CreateExperimentBodySchema, UpdateExperimentBodySchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import { notFound, parse } from '../errors.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerExperimentRoutes(app: FastifyInstance, db: Database): void {
  const load = async (id: string) => {
    const row = await db
      .selectFrom('experiment')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('Experiment');
    return row;
  };

  app.post('/v1/experiments', async (request, reply) => {
    const body = parse(CreateExperimentBodySchema, request.body);
    const principal = authorize(request, 'create', 'Experiment', body.program_id);
    const created = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('experiment')
        .values({ ...body, tenant_id: principal.tenantId, created_by: principal.userId, urn: '' })
        .returningAll()
        .executeTakeFirstOrThrow();
      await writeAudit(trx, request, {
        action: 'experiment.create',
        entityType: 'experiment',
        entityId: row.id,
        after: row,
      });
      return row;
    });
    return reply.status(201).send(created);
  });

  app.get('/v1/experiments/:id', async (request: IdParams) => {
    const row = await load(request.params.id);
    authorize(request, 'read', 'Experiment', row.program_id);
    return row;
  });

  app.patch('/v1/experiments/:id', async (request: IdParams) => {
    const before = await load(request.params.id);
    authorize(request, 'update', 'Experiment', before.program_id);
    const body = parse(UpdateExperimentBodySchema, request.body);
    return db.transaction().execute(async (trx) => {
      const after = await trx
        .updateTable('experiment')
        .set(body)
        .where('id', '=', before.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await writeAudit(trx, request, {
        action: 'experiment.update',
        entityType: 'experiment',
        entityId: before.id,
        before,
        after,
      });
      return after;
    });
  });
}
