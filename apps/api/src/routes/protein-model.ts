// Protein 3D models (Phase 29, STRUC-01). Public reference structures: any signed-in user; nothing is stored.
import { ProteinModelSchema } from '@tributary/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { resolveModel } from '../protein-model/source.ts';
import { respond } from '../respond.ts';

type IdParams = FastifyRequest<{ Params: { id: string } }>;

export function registerProteinModelRoutes(
  app: FastifyInstance,
  deps: { config: ApiConfig; fetch: typeof fetch },
): void {
  app.get('/v1/proteins/:id/model', async (request: IdParams) => {
    requirePrincipal(request);
    const { model } = await resolveModel(deps.config, deps.fetch, request.params.id);
    return respond(ProteinModelSchema, model);
  });

  app.get('/v1/proteins/:id/model.cif', async (request: IdParams, reply) => {
    requirePrincipal(request);
    const resolved = await resolveModel(deps.config, deps.fetch, request.params.id);
    const text = await resolved.file();
    return reply
      .type('chemical/x-mmcif; charset=utf-8')
      .header('cache-control', 'private, max-age=3600')
      .send(text);
  });
}
