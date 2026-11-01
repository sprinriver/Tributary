import { ChartRenderBodySchema, ChartRenderSchema } from '@tributary/contracts';
import type { FastifyInstance } from 'fastify';
import { requirePrincipal } from '../auth/plugin.ts';
import { renderChart, type ChartDeps } from '../charts/render.ts';
import { parse } from '../errors.ts';
import { respond } from '../respond.ts';

export function registerChartRoutes(app: FastifyInstance, deps: ChartDeps): void {
  app.post('/v1/charts/render', async (request) => {
    requirePrincipal(request);
    const body = parse(ChartRenderBodySchema, request.body);
    return respond(ChartRenderSchema, await renderChart(deps, request, body.spec));
  });
}
