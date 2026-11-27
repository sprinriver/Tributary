// Reference data from public sources (public annotation plan). Stage 1: protein facts from UniProt (UNI-01).
import { UniprotRefreshBodySchema, UniprotRefreshResultSchema } from '@tributary/contracts';
import type { FastifyInstance } from 'fastify';
import { requireSystemAdmin } from '../auth/plugin.ts';
import { parse } from '../errors.ts';
import { respond } from '../respond.ts';
import { refreshUniprot, type Deps } from '../uniprot/refresh.ts';

export function registerReferenceRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/v1/admin/reference/uniprot', async (request) => {
    requireSystemAdmin(request);
    parse(UniprotRefreshBodySchema, request.body ?? {});
    return respond(UniprotRefreshResultSchema, await refreshUniprot(deps, request));
  });
}
