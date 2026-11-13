// Cross-experiment QC and batch effects (Phase 27, QCD-01/02). Read-only: nothing is stored or audited.
import { QcOverviewBodySchema, QcOverviewSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { authorize, readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { parse } from '../errors.ts';
import { qcOverview } from '../qc/overview.ts';
import { respond } from '../respond.ts';

export function registerQcRoutes(
  app: FastifyInstance,
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
): void {
  app.post('/v1/qc/overview', async (request) => {
    const body = parse(QcOverviewBodySchema, request.body ?? {});
    if (body.program_id) authorize(request, 'read', 'Dataset', body.program_id);
    const readable = readablePrograms(requirePrincipal(request));
    return respond(QcOverviewSchema, await qcOverview(deps, readable, body));
  });
}
