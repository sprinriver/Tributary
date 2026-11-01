import {
  CreateExperimentBodySchema,
  ExperimentDetailSchema,
  ExperimentListSchema,
  ItemsSchema,
  ListExperimentsQuerySchema,
  UpdateExperimentBodySchema,
  VersionSummarySchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { SearchIndex } from '../search/index-service.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeAudit } from '../audit.ts';
import { authorize, readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import { notFound, parse } from '../errors.ts';
import { experimentDetail } from '../registry/load.ts';
import { listExperiments } from '../registry/list.ts';
import { currentTemplate, fieldToRow } from '../registry/templates.ts';
import { checkCustomFields, parseCustomValues, parseTimePoints } from '../registry/values.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;
const json = (value: unknown) => JSON.stringify(value);

export function registerExperimentRoutes(app: FastifyInstance, db: Database, index: SearchIndex): void {
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

  app.get('/v1/experiments', async (request) => {
    const query = parse(ListExperimentsQuerySchema, request.query);
    return respond(
      ExperimentListSchema,
      await listExperiments(db, query, readablePrograms(requirePrincipal(request))),
    );
  });

  app.post('/v1/experiments', async (request, reply) => {
    const body = parse(CreateExperimentBodySchema, request.body);
    const principal = authorize(request, 'create', 'Experiment', body.program_id);
    const template = await currentTemplate(db, body.assay_type);
    const customFields = body.custom_fields ?? [];
    checkCustomFields(customFields, new Set(template.fields.map((f) => f.key)));
    const custom = parseCustomValues(customFields, body.custom ?? {});
    const timePoints = parseTimePoints(body.time_points ?? []);
    const base = { tenant_id: principal.tenantId, created_by: principal.userId };

    const id = await db.transaction().execute(async (trx) => {
      const experiment = await trx
        .insertInto('experiment')
        .values({
          ...base,
          program_id: body.program_id,
          assay_type: body.assay_type,
          name: body.name,
          urn: '',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const version = await trx
        .insertInto('experiment_version')
        .values({
          ...base,
          experiment_id: experiment.id,
          version_number: 1,
          template_version: template.version,
          experiment_date: body.experiment_date ?? null,
          species: body.species ? json(body.species) : null,
          spectral_library: body.spectral_library ?? null,
          time_points: json(timePoints),
          description: body.description ?? '',
          custom: json(custom),
          urn: '',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (customFields.length) {
        await trx
          .insertInto('metadata_field_def')
          .values(
            customFields.map((f, i) => ({ ...base, experiment_version_id: version.id, ...fieldToRow(f, i) })),
          )
          .execute();
      }
      await writeAudit(trx, request, {
        action: 'experiment.create',
        entityType: 'experiment',
        entityId: experiment.id,
        after: experiment,
      });
      await writeAudit(trx, request, {
        action: 'experiment_version.create',
        entityType: 'experiment_version',
        entityId: version.id,
        after: { ...version, custom_fields: customFields },
      });
      return experiment.id;
    });
    return reply.status(201).send(respond(ExperimentDetailSchema, await experimentDetail(db, id)));
  });

  app.get('/v1/experiments/:id', async (request: IdParams) => {
    const detail = await experimentDetail(db, request.params.id);
    authorize(request, 'read', 'Experiment', detail.program_id);
    return respond(ExperimentDetailSchema, detail);
  });

  app.get('/v1/experiments/:id/versions', async (request: IdParams) => {
    const detail = await experimentDetail(db, request.params.id);
    authorize(request, 'read', 'Experiment', detail.program_id);
    return respond(ItemsSchema(VersionSummarySchema), { items: detail.versions });
  });

  app.patch('/v1/experiments/:id', async (request: IdParams) => {
    const before = await load(request.params.id);
    const principal = authorize(request, 'update', 'Experiment', before.program_id);
    const body = parse(UpdateExperimentBodySchema, request.body);
    await db.transaction().execute(async (trx) => {
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
      await index.experiment(trx as unknown as Database, before.id, principal.userId);
    });
    index.afterCommit(principal.userId);
    return respond(ExperimentDetailSchema, await experimentDetail(db, before.id));
  });

  for (const [path, archived] of [
    ['archive', true],
    ['unarchive', false],
  ] as const) {
    app.post(`/v1/experiments/:id/${path}`, async (request: IdParams) => {
      const before = await load(request.params.id);
      const principal = authorize(request, 'update', 'Experiment', before.program_id);
      await db.transaction().execute(async (trx) => {
        const after = await trx
          .updateTable('experiment')
          .set({ archived_at: archived ? new Date() : null })
          .where('id', '=', before.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await writeAudit(trx, request, {
          action: `experiment.${path}`,
          entityType: 'experiment',
          entityId: before.id,
          before,
          after,
        });
        await index.experiment(trx as unknown as Database, before.id, principal.userId);
      });
      index.afterCommit(principal.userId);
      return respond(ExperimentDetailSchema, await experimentDetail(db, before.id));
    });
  }
}
