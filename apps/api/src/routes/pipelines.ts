import {
  LaunchRunBodySchema,
  PipelineDefinitionBodySchema,
  PipelineListSchema,
  PipelineSchema,
  RunDetailSchema,
  RunListSchema,
  RunLogsSchema,
  type Pipeline,
} from '@tributary/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { authorize, requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { canLaunch } from '../ingest/gate.ts';
import { loadRun, versionRuns } from '../pipelines/load.ts';
import type { PipelineDeps } from '../pipelines/service.ts';
import { applyRunStatus } from '../pipelines/status.ts';
import { contrastsOf, loadVersion } from '../registry/load.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);
/** node-postgres returns arrays of custom enum types (assay_type_key[]) as the literal "{a,b}". */
const pgArray = (v: unknown): string[] =>
  Array.isArray(v)
    ? (v as string[])
    : typeof v === 'string'
      ? v
          .replace(/^\{|\}$/g, '')
          .split(',')
          .filter(Boolean)
      : [];

const pipelineRow = (r: {
  id: string;
  key: string;
  name: string;
  repo: string;
  revision: string;
  runner_types: string[];
  assay_types: string[];
  params_schema: unknown;
  default_params: unknown;
  output_importers: unknown;
  created_at: Date | string;
}): Pipeline => ({
  ...r,
  runner_types: pgArray(r.runner_types) as Pipeline['runner_types'],
  assay_types: pgArray(r.assay_types) as Pipeline['assay_types'],
  params_schema: r.params_schema as Pipeline['params_schema'],
  default_params: r.default_params as Pipeline['default_params'],
  output_importers: r.output_importers as Pipeline['output_importers'],
  created_at: iso(r.created_at),
});

export function registerPipelineRoutes(app: FastifyInstance, deps: PipelineDeps): void {
  const { db, runners } = deps;
  const COLUMNS = [
    'id',
    'key',
    'name',
    'repo',
    'revision',
    'runner_types',
    'assay_types',
    'params_schema',
    'default_params',
    'output_importers',
    'created_at',
  ] as const;
  const detail = async (id: string) => {
    const { program_id: _p, ...run } = await loadRun(db, id);
    return run;
  };

  app.get('/v1/pipelines', async (request) => {
    requirePrincipal(request);
    const rows = await db
      .selectFrom('pipeline_definition')
      .select(COLUMNS)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
    return respond(PipelineListSchema, { items: rows.map(pipelineRow) });
  });

  app.post('/v1/admin/pipelines', async (request, reply) => {
    requireSystemAdmin(request);
    const body = parse(PipelineDefinitionBodySchema, request.body);
    const actor = requestActor(request);
    const row = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('pipeline_definition')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          key: body.key,
          name: body.name,
          repo: body.repo,
          revision: body.revision,
          runner_types: body.runner_types,
          assay_types: body.assay_types,
          params_schema: JSON.stringify(body.params_schema),
          default_params: JSON.stringify(body.default_params),
          output_importers: JSON.stringify(body.output_importers),
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      await insertAudit(trx, actor, {
        action: 'pipeline.create',
        entityType: 'pipeline_definition',
        entityId: created.id,
        after: body,
      });
      return created;
    });
    reply.code(201);
    return respond(PipelineSchema, pipelineRow(row));
  });

  app.post('/v1/runs', async (request, reply) => {
    const body = parse(LaunchRunBodySchema, request.body);
    const version = await loadVersion(db, body.experiment_version_id);
    authorize(request, 'create', 'PipelineRun', version.program_id);
    const definition = await db
      .selectFrom('pipeline_definition')
      .select(COLUMNS)
      .where('id', '=', body.pipeline_definition_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!definition) throw notFound('Pipeline');
    if (!pgArray(definition.runner_types).includes(body.runner)) {
      throw new HttpError(
        422,
        'runner_not_allowed',
        `${definition.name} does not run on ${body.runner}.`,
        'runner',
      );
    }
    if (!pgArray(definition.assay_types).includes(version.assay_type)) {
      throw new HttpError(
        422,
        'assay_not_supported',
        `${definition.name} does not support ${version.assay_type}.`,
      );
    }
    const runner = runners[body.runner];
    if (!runner)
      throw new HttpError(
        422,
        'runner_unavailable',
        `The ${body.runner} runner is not configured here.`,
        'runner',
      );
    if (version.status !== 'published') {
      throw new HttpError(422, 'not_published', 'Publish the version before launching a pipeline on it.');
    }
    // SPEC M3 QC gate: failed QC blocks launch until an approver overrides it.
    const gate = await canLaunch(db, version.id);
    if (!gate.can_launch) {
      const first = gate.blockers[0]!;
      throw new HttpError(
        422,
        'qc_gate',
        `${first.name}: ${first.reason}`,
        'experiment_version_id',
        gate.blockers.map((b) => ({ code: b.status, field: b.file_id, message: `${b.name}: ${b.reason}` })),
      );
    }
    const params: Record<string, string | number | boolean> = {
      ...(definition.default_params as Record<string, string | number | boolean>),
      ...body.params,
    };
    // The contrast a differential pipeline runs for is part of its inputs; recorded explicitly when there is one.
    if (params.contrast_id === undefined) {
      const contrasts = await contrastsOf(db, version.id);
      if (contrasts.length === 1) params.contrast_id = contrasts[0]!.id;
    }
    const actor = requestActor(request);
    const created = await db
      .insertInto('pipeline_run')
      .values({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        pipeline_definition_id: definition.id,
        experiment_version_id: version.id,
        runner: body.runner,
        params: JSON.stringify(params),
        triggered_by: actor.userId,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();
    const root = `s3://${deps.storage.config.workBucket}/runs/${created.id}`;
    const spec = {
      runId: created.id,
      pipeline: { key: definition.key, repo: definition.repo, revision: definition.revision },
      params,
      workUri: `${root}/work/`,
      outputUri: `${root}/output/`,
    };
    let started: { externalId: string; workDir?: string | undefined };
    try {
      started = await runner.start(spec);
    } catch (error) {
      await applyRunStatus(db, actor, created.id, {
        status: 'failed',
        externalStatus: 'start_failed',
        at: new Date(),
        source: 'api',
        reason: (error as Error).message,
      });
      throw new HttpError(
        502,
        'runner_failed',
        `The ${body.runner} runner could not start the run: ${(error as Error).message}`,
      );
    }
    const links = await runner.logLinks(started.externalId).catch(() => []);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('pipeline_run')
        .set({
          external_id: started.externalId,
          work_dir: started.workDir ?? spec.workUri,
          output_uri: spec.outputUri,
          log_links: JSON.stringify(links),
        })
        .where('id', '=', created.id)
        .execute();
      await insertAudit(trx, actor, {
        action: 'run.launch',
        entityType: 'pipeline_run',
        entityId: created.id,
        after: {
          pipeline: definition.key,
          runner: body.runner,
          external_id: started.externalId,
          params,
          experiment_version_id: version.id,
        },
      });
    });
    await db
      .insertInto('pipeline_run_event')
      .values({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        pipeline_run_id: created.id,
        status: 'submitted',
        external_status: 'submitted',
        event_time: new Date(),
        source: 'api',
        reason: null,
        applied: true,
      })
      .execute();
    reply.code(201);
    return respond(RunDetailSchema, await detail(created.id));
  });

  app.get('/v1/runs/:id', async (request: IdParams) => {
    const run = await loadRun(db, request.params.id);
    authorize(request, 'read', 'PipelineRun', run.program_id);
    const { program_id: _p, ...rest } = run;
    return respond(RunDetailSchema, rest);
  });

  app.get('/v1/versions/:id/runs', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'read', 'PipelineRun', version.program_id);
    return respond(RunListSchema, { items: await versionRuns(db, version.id) });
  });

  app.post('/v1/runs/:id/cancel', async (request: IdParams) => {
    const run = await loadRun(db, request.params.id);
    authorize(request, 'update', 'PipelineRun', run.program_id);
    if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
      throw new HttpError(409, 'run_finished', `The run is already ${run.status}.`);
    }
    const runner = runners[run.runner];
    if (!runner || !run.external_id)
      throw new HttpError(422, 'runner_unavailable', 'This run cannot be cancelled here.');
    await runner.cancel(run.external_id);
    await insertAudit(db, requestActor(request), {
      action: 'run.cancel',
      entityType: 'pipeline_run',
      entityId: run.id,
      before: { status: run.status },
    });
    return respond(RunDetailSchema, await detail(run.id));
  });

  app.get('/v1/runs/:id/logs', async (request: IdParams) => {
    const run = await loadRun(db, request.params.id);
    authorize(request, 'read', 'PipelineRun', run.program_id);
    const runner = runners[run.runner];
    const lines =
      runner && run.external_id ? await runner.recentLogs(run.external_id, 200).catch(() => []) : [];
    const links =
      runner && run.external_id
        ? await runner.logLinks(run.external_id).catch(() => run.log_links)
        : run.log_links;
    return respond(RunLogsSchema, { links, lines });
  });
}
