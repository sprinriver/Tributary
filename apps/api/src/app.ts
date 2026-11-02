import cookie from '@fastify/cookie';
import { genRequestId, registerTracing, tracedFetch } from './tracing.ts';
import type { HealthStatus } from '@tributary/contracts';
import { createDb, type Database } from '@tributary/db';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { OidcClient, type Introspection } from './auth/oidc.ts';
import { registerMcpRoutes } from './mcp/server.ts';
import { registerAuth, requireSystemAdmin } from './auth/plugin.ts';
import { loadConfig, type ApiConfig } from './config.ts';
import { registerErrorHandler } from './errors.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerExperimentRoutes } from './routes/experiments.ts';
import { registerDatasetRoutes } from './routes/datasets.ts';
import { registerFileRoutes } from './routes/files.ts';
import { registerImportRoutes } from './routes/imports.ts';
import { registerLifecycleRoutes } from './routes/lifecycle.ts';
import { registerQcGateRoutes } from './routes/qc-gate.ts';
import { registerPipelineRoutes } from './routes/pipelines.ts';
import { registerQueryRoutes } from './routes/query.ts';
import { registerViewRoutes } from './routes/views.ts';
import { registerChartRoutes } from './routes/charts.ts';
import { registerResultRoutes } from './routes/results.ts';
import type { Runners } from './pipelines/runner.ts';
import { runIngest } from './ingest/job.ts';
import type { IngestQueue } from './ingest/queue.ts';
import { Storage } from './storage.ts';
import { registerOntologyRoutes } from './routes/ontology.ts';
import { registerPresetRoutes, registerProgramRoutes } from './routes/programs.ts';
import { registerSampleRoutes } from './routes/samples.ts';
import { registerSdrfRoutes } from './routes/sdrf.ts';
import { registerVersionRoutes } from './routes/versions.ts';
import { registerSearchRoutes } from './routes/search.ts';
import { registerTrustRoutes } from './routes/trust.ts';
import { registerAdminTemplateRoutes } from './routes/admin-templates.ts';
import { registerAdminSettingsRoutes } from './routes/admin-settings.ts';
import { registerAiRoutes } from './routes/ai.ts';
import { registerWebhookRoutes } from './routes/webhooks.ts';
import { providerFor, type ModelProvider } from './ai/provider.ts';
import { systemHealth } from './admin/health.ts';
import { HealthReportSchema, InstanceInfoSchema } from '@tributary/contracts';
import { respond } from './respond.ts';
import { embeddingProvider } from './search/embeddings.ts';
import { searchIndex } from './search/index-service.ts';

import { API_VERSION } from './version.ts';
export { API_VERSION };

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
  /** Pipeline runners by kind (server.ts builds them from config; tests pass a fake). */
  runners?: Runners;
  /** IdP token introspection for MCP clients; defaults to the OIDC client (tests pass a fake). */
  introspect?: (token: string) => Promise<Introspection>;
  /** The assistant's model; defaults to `providerFor(config.ai)`. Tests may pass a scripted provider. */
  aiProvider?: ModelProvider | null;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const db = options.db ?? createDb(config.databaseUrl);
  // Calls to query and compute carry the request id and trace context (tracing.ts).
  const fetchImpl = tracedFetch(options.fetch ?? fetch, [config.queryUrl, config.computeUrl]);
  const storage = options.storage ?? new Storage(config.s3);
  const app = Fastify({ ...options.server, genReqId: genRequestId });
  registerTracing(app);
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
  const provider = embeddingProvider(config.search, { fetch: fetchImpl, computeUrl: config.computeUrl });
  const index = searchIndex(db, provider, app.log);
  const aiProvider = options.aiProvider === undefined ? providerFor(config.ai) : options.aiProvider;
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

    const oidc = new OidcClient(config);
    registerAuthRoutes(scoped, db, config, oidc);
    scoped.get('/v1/instance', { config: { public: true } }, async () =>
      respond(InstanceInfoSchema, {
        name: config.instance.name,
        version: API_VERSION,
        demo: config.instance.demo,
        demo_logins: config.instance.demoLogins,
        notice: config.instance.notice,
      }),
    );
    registerMcpRoutes(scoped, {
      root: app,
      db,
      config,
      introspect: options.introspect ?? ((token) => oidc.introspect(token)),
    });
    registerProgramRoutes(scoped, db);
    registerExperimentRoutes(scoped, db, index);
    registerVersionRoutes(scoped, db, index);
    registerSampleRoutes(scoped, db);
    registerPresetRoutes(scoped, db);
    registerOntologyRoutes(scoped, db, config, fetchImpl);
    registerSdrfRoutes(scoped, db, config, fetchImpl);
    registerFileRoutes(scoped, db, storage, ingestQueue);
    registerQcGateRoutes(scoped, db);
    registerLifecycleRoutes(scoped, db);
    registerImportRoutes(scoped, db, config, storage, fetchImpl);
    registerQueryRoutes(scoped, db, config, storage, fetchImpl);
    registerViewRoutes(scoped, db);
    registerSearchRoutes(scoped, { db, config, provider, index });
    registerTrustRoutes(scoped, db);
    registerAdminTemplateRoutes(scoped, db);
    registerAdminSettingsRoutes(scoped, db, config);
    registerAiRoutes(scoped, { root: app, db, config, provider: aiProvider });
    registerWebhookRoutes(scoped, { db, config, fetch: fetchImpl });
    scoped.get('/v1/admin/health', async (request) => {
      requireSystemAdmin(request);
      return respond(
        HealthReportSchema,
        await systemHealth({ db, config, storage, fetch: fetchImpl, runners: options.runners ?? {} }),
      );
    });
    registerChartRoutes(scoped, { db, config, fetch: fetchImpl });
    registerResultRoutes(scoped, { db, config, fetch: fetchImpl });
    registerDatasetRoutes(scoped, db, config, fetchImpl);
    registerPipelineRoutes(scoped, { db, config, storage, fetch: fetchImpl, runners: options.runners ?? {} });
  });
  return app;
}
