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
import { registerDatasetRoutes } from './routes/datasets.ts';
import { registerFileRoutes } from './routes/files.ts';
import { registerImportRoutes } from './routes/imports.ts';
import { registerLifecycleRoutes } from './routes/lifecycle.ts';
import { registerQcGateRoutes } from './routes/qc-gate.ts';
import { runIngest } from './ingest/job.ts';
import type { IngestQueue } from './ingest/queue.ts';
import { Storage } from './storage.ts';
import { registerOntologyRoutes } from './routes/ontology.ts';
import { registerPresetRoutes, registerProgramRoutes } from './routes/programs.ts';
import { registerSampleRoutes } from './routes/samples.ts';
import { registerSdrfRoutes } from './routes/sdrf.ts';
import { registerVersionRoutes } from './routes/versions.ts';

export const API_VERSION = '0.0.0';

export interface AppOptions {
  /** Defaults to a pool on `config.databaseUrl`, closed with the app. */
  db?: Database;
  config?: ApiConfig;
  /** Outbound HTTP (OLS4, apps/compute); tests pass a fake. */
  fetch?: typeof fetch;
  server?: FastifyServerOptions;
  /** Object storage; defaults to `config.s3`. */
  storage?: Storage;
  /** Where completed uploads go for ingest. server.ts passes pg-boss; the default runs jobs in-process. */
  ingestQueue?: IngestQueue;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const db = options.db ?? createDb(config.databaseUrl);
  const fetchImpl = options.fetch ?? fetch;
  const storage = options.storage ?? new Storage(config.s3);
  const app = Fastify({ ...options.server, genReqId: () => crypto.randomUUID() });
  const ingestQueue: IngestQueue = options.ingestQueue ?? {
    async enqueue(fileId) {
      setImmediate(() => {
        runIngest({ db, storage }, fileId).catch((error: unknown) =>
          app.log.error({ error, fileId }, 'ingest failed'),
        );
      });
    },
  };
  if (!options.db) app.addHook('onClose', () => db.destroy());

  registerErrorHandler(app);
  // Clients often send `content-type: application/json` with no body (e.g. POST …/clone); treat it as no body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error('The request body is not valid JSON.'), { statusCode: 400 }), undefined);
    }
  });
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
    registerPresetRoutes(scoped, db);
    registerOntologyRoutes(scoped, db, config, fetchImpl);
    registerSdrfRoutes(scoped, db, config, fetchImpl);
    registerFileRoutes(scoped, db, storage, ingestQueue);
    registerQcGateRoutes(scoped, db);
    registerLifecycleRoutes(scoped, db);
    registerImportRoutes(scoped, db, config, storage, fetchImpl);
    registerDatasetRoutes(scoped, db, config, fetchImpl);
  });
  return app;
}
