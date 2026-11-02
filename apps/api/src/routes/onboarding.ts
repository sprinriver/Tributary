// Legacy onboarding (Phase 23, ING-06): plan (dry run), run in resumable batches, migration report.
import { OnboardingPlanSchema, OnboardingRunSchema, OnboardingSpecSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import { HttpError, parse } from '../errors.ts';
import { inferPlan } from '../onboarding/infer.ts';
import { loadReport } from '../onboarding/report.ts';
import { callerInject, createRun, processRun } from '../onboarding/run.ts';
import { respond } from '../respond.ts';
import type { Storage } from '../storage.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerOnboardingRoutes(app: FastifyInstance, db: Database, storage: Storage): void {
  async function plan(request: FastifyRequest) {
    const spec = parse(OnboardingSpecSchema, request.body);
    authorize(request, 'create', 'Experiment', spec.program_id);
    authorize(request, 'create', 'File', spec.program_id);
    if (!storage.config.linkablePrefixes.some((allowed) => spec.prefix.startsWith(allowed))) {
      throw new HttpError(
        422,
        'prefix_not_linkable',
        `Only objects under ${storage.config.linkablePrefixes.join(', ')} can be onboarded.`,
        'prefix',
      );
    }
    const objects = await storage.list(spec.prefix);
    if (!objects.length) throw new HttpError(422, 'prefix_empty', 'No objects under this prefix.', 'prefix');
    return { spec, plan: inferPlan(spec, objects) };
  }

  const report = async (id: string) => {
    const { tenant_id: _tenant, ...body } = await loadReport(db, id);
    return respond(OnboardingRunSchema, body);
  };

  app.post('/v1/onboarding/plan', async (request) =>
    respond(OnboardingPlanSchema, (await plan(request)).plan),
  );

  app.post('/v1/onboarding/runs', async (request, reply) => {
    const { spec, plan: inferred } = await plan(request);
    const actor = requestActor(request);
    const id = await createRun(db, actor, spec, inferred);
    await insertAudit(db, actor, {
      action: 'onboarding.run',
      entityType: 'onboarding_run',
      entityId: id,
      after: {
        prefix: spec.prefix,
        patterns: spec.patterns,
        experiments: inferred.experiments.length,
        files: inferred.experiments.reduce((n, e) => n + e.files.length, 0),
        unmatched: inferred.unmatched.length,
      },
    });
    await processRun(db, callerInject(request, `legacy onboarding ${id}`), id);
    reply.code(201);
    return report(id);
  });

  app.get('/v1/onboarding/runs/:id', async (request: IdParams) => {
    const run = await loadReport(db, request.params.id);
    authorize(request, 'read', 'File', run.program_id);
    return report(run.id);
  });

  app.post('/v1/onboarding/runs/:id/resume', async (request: IdParams) => {
    const run = await loadReport(db, request.params.id);
    authorize(request, 'create', 'Experiment', run.program_id);
    authorize(request, 'create', 'File', run.program_id);
    await insertAudit(db, requestActor(request), {
      action: 'onboarding.resume',
      entityType: 'onboarding_run',
      entityId: run.id,
      before: { status: run.status, counts: run.counts },
    });
    await processRun(db, callerInject(request, `legacy onboarding ${run.id}`), run.id);
    return report(run.id);
  });
}
