import {
  DATASET_CONTRACTS,
  DatasetDetailSchema,
  DatasetKindSchema,
  DatasetListSchema,
  ListDatasetsQuerySchema,
  PreviewQuerySchema,
  ReleaseDetailSchema,
  ReleasePreviewSchema,
  ReleaseReasonBodySchema,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { authorize, readablePrograms, requirePrincipal, requireRecentAuth } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { listDatasets, loadDataset, loadRelease } from '../datasets/load.ts';
import { odcsYaml } from '../datasets/odcs.ts';
import { readRelease } from '../datasets/query-client.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { notifyWatchers } from '../watch/notify.ts';
import { releasePublished } from '../notifications/emit.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerDatasetRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  fetchImpl: typeof fetch,
): void {
  const detail = async (id: string) => {
    const { requires_approval: _ra, ...release } = await loadRelease(db, id);
    return release;
  };

  app.get('/v1/datasets', async (request) => {
    const query = parse(ListDatasetsQuerySchema, request.query);
    const items = await listDatasets(db, query, readablePrograms(requirePrincipal(request)));
    return respond(DatasetListSchema, { items });
  });

  app.get('/v1/datasets/:id', async (request: IdParams) => {
    const dataset = await loadDataset(db, request.params.id);
    authorize(request, 'read', 'Dataset', dataset.program_id);
    return respond(DatasetDetailSchema, dataset);
  });

  app.get('/v1/releases/:id', async (request: IdParams) => {
    const release = await detail(request.params.id);
    authorize(request, 'read', 'Dataset', release.program_id);
    return respond(ReleaseDetailSchema, release);
  });

  app.get('/v1/releases/:id/preview', async (request: IdParams) => {
    const query = parse(PreviewQuerySchema, request.query);
    const release = await detail(request.params.id);
    authorize(request, 'read', 'Dataset', release.program_id);
    if (!release.storage)
      throw new HttpError(409, 'no_data', 'This release has no stored rows (it was rejected).');
    const keys = release.contract.qualityRules.find((r) => r.kind === 'unique')?.columns ?? [];
    return respond(
      ReleasePreviewSchema,
      await readRelease(fetchImpl, config, release.storage, query.limit, keys),
    );
  });

  // Staged → published | rejected, with a reason; the DB trigger keeps both final (SPEC M5).
  const decide = (to: 'published' | 'rejected') => async (request: IdParams) => {
    requireRecentAuth(request);
    const body = parse(ReleaseReasonBodySchema, request.body);
    const release = await loadRelease(db, request.params.id);
    const action = to === 'published' && release.requires_approval ? 'approve' : 'publish';
    authorize(request, action, 'Dataset', release.program_id);
    if (release.status !== 'staged') {
      throw new HttpError(
        409,
        'immutable',
        `Release ${release.release_number} is ${release.status}; it cannot change.`,
      );
    }
    const actor = requestActor(request);
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('dataset_release')
        .set({
          status: to,
          status_reason: body.reason,
          ...(to === 'published' ? { published_at: new Date() } : {}),
        })
        .where('id', '=', release.id)
        .execute();
      await insertAudit(trx, actor, {
        action: to === 'published' ? 'release.publish' : 'release.reject',
        entityType: 'dataset_release',
        entityId: release.id,
        before: { status: release.status },
        after: { status: to },
        reason: body.reason,
      });
    });
    // Watchers of the release's hits hear about it (best effort; never fails the publish).
    if (to === 'published') {
      await notifyWatchers({ db, config, fetch: fetchImpl }, release.id, actor, request.log);
      await releasePublished({ db, config }, actor, release.id, request.log);
    }
    return respond(ReleaseDetailSchema, await detail(release.id));
  };
  app.post('/v1/releases/:id/publish', decide('published'));
  app.post('/v1/releases/:id/reject', decide('rejected'));

  app.get(
    '/v1/contracts/:kind/odcs',
    async (request: FastifyRequest<{ Params: { kind: string } }>, reply) => {
      const kind = DatasetKindSchema.safeParse(request.params.kind);
      if (!kind.success) throw notFound('Dataset kind');
      return reply
        .type('application/yaml; charset=utf-8')
        .header('content-disposition', `attachment; filename="${kind.data}.odcs.yaml"`)
        .send(odcsYaml(DATASET_CONTRACTS[kind.data]));
    },
  );
}
