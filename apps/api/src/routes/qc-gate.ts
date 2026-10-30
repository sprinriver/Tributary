import { QcGateSchema, QcOverrideBodySchema, QcOverrideSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requestActor, insertAudit } from '../audit.ts';
import { authorize } from '../auth/plugin.ts';
import { HttpError, parse } from '../errors.ts';
import { canLaunch, failedFiles, latestOverride } from '../ingest/gate.ts';
import { loadVersion } from '../registry/load.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerQcGateRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/versions/:id/qc-gate', async (request: IdParams) => {
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'read', 'ExperimentVersion', version.program_id);
    return respond(QcGateSchema, await canLaunch(db, version.id));
  });

  // SPEC M3: an approver overrides failed QC with a reason; the override and its reason are audited.
  app.post('/v1/versions/:id/qc-override', async (request: IdParams, reply) => {
    const body = parse(QcOverrideBodySchema, request.body);
    const version = await loadVersion(db, request.params.id);
    authorize(request, 'approve', 'ExperimentVersion', version.program_id);
    const fileIds = await failedFiles(db, version.id);
    if (!fileIds.length)
      throw new HttpError(422, 'nothing_to_override', 'No file of this version failed QC.');
    const actor = requestActor(request);
    await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('qc_override')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          experiment_version_id: version.id,
          reason: body.reason,
          file_ids: fileIds,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await insertAudit(trx, actor, {
        action: 'qc.override',
        entityType: 'experiment_version',
        entityId: version.id,
        after: { override_id: row.id, file_ids: fileIds },
        reason: body.reason,
      });
    });
    reply.code(201);
    return respond(QcOverrideSchema, await latestOverride(db, version.id));
  });
}
