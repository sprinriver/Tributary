import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { HealthStatus } from '@tributary/contracts';

export const API_VERSION = '0.0.0';

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  // Liveness: the process is up.
  app.get('/healthz', async (): Promise<HealthStatus> => ({
    service: 'api',
    status: 'ok',
    version: API_VERSION,
  }));

  // Readiness: dependencies (database, query service) are checked here once they exist (Phase 2+).
  app.get('/readyz', async (): Promise<HealthStatus> => ({
    service: 'api',
    status: 'ok',
    version: API_VERSION,
  }));

  return app;
}
