import cookie from '@fastify/cookie';
import type { HealthStatus } from '@tributary/contracts';
import { createDb, type Database } from '@tributary/db';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { OidcClient } from './auth/oidc.ts';
import { registerAuth } from './auth/plugin.ts';
import { loadConfig, type ApiConfig } from './config.ts';
import { registerErrorHandler } from './errors.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerExperimentRoutes } from './routes/experiments.ts';
import { registerProgramRoutes } from './routes/programs.ts';
import { registerSampleRoutes } from './routes/samples.ts';
import { registerVersionRoutes } from './routes/versions.ts';

export const API_VERSION = '0.0.0';

export interface AppOptions {
  /** Defaults to a pool on `config.databaseUrl`, closed with the app. */
  db?: Database;
  config?: ApiConfig;
  server?: FastifyServerOptions;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const db = options.db ?? createDb(config.databaseUrl);
  const app = Fastify({ ...options.server, genReqId: () => crypto.randomUUID() });
  if (!options.db) app.addHook('onClose', () => db.destroy());

  registerErrorHandler(app);
  void app.register(cookie, { secret: config.cookieSecret });
  void app.register(async (scoped) => {
    registerAuth(scoped, db, config);

    // Liveness: the process is up.
    scoped.get('/healthz', { config: { public: true } }, async (): Promise<HealthStatus> => ({
      service: 'api',
      status: 'ok',
      version: API_VERSION,
    }));
    // Readiness: dependencies are checked here as they are added.
    scoped.get('/readyz', { config: { public: true } }, async (): Promise<HealthStatus> => ({
      service: 'api',
      status: 'ok',
      version: API_VERSION,
    }));

    registerAuthRoutes(scoped, db, config, new OidcClient(config));
    registerProgramRoutes(scoped, db);
    registerExperimentRoutes(scoped, db);
    registerVersionRoutes(scoped, db);
    registerSampleRoutes(scoped, db);
  });
  return app;
}
