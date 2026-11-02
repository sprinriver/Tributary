import { DuckDBInstance } from '@duckdb/node-api';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { loadQueryConfig, type QueryConfig } from './config.ts';
import { createDb } from '@tributary/db';
import { registerImportRoutes } from './imports.ts';
import { registerQueryRoutes } from './queries.ts';
import { Objects } from './objects.ts';

export interface QueryAppOptions {
  server?: FastifyServerOptions;
  config?: QueryConfig;
}

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Internal query service: the importer executor (Phase 8) and, from Phase 12, the QuerySpec compiler.
 * One DuckDB instance per process (ARCHITECTURE §6).
 */
export async function buildApp(options: QueryAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadQueryConfig();
  // OPS-08: log under apps/api's request id (x-request-id) and trace id (traceparent), and echo the id.
  const app = Fastify({
    ...options.server,
    genReqId: (req) => {
      const id = req.headers['x-request-id'];
      return typeof id === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(id) ? id : randomUUID();
    },
  });
  app.addHook('onRequest', async (request, reply) => {
    const trace = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(
      String(request.headers.traceparent ?? ''),
    );
    if (trace) request.log = request.log.child({ traceId: trace[1] });
    void reply.header('x-request-id', request.id);
  });
  // ARCHITECTURE §6: one DuckDB instance per process; memory, threads and spill directory from config.
  const settings: Record<string, string> = {};
  if (config.duckdb.memoryLimit) settings.memory_limit = config.duckdb.memoryLimit;
  if (config.duckdb.threads) settings.threads = String(config.duckdb.threads);
  if (config.duckdb.tempDirectory) settings.temp_directory = config.duckdb.tempDirectory;
  const db = await DuckDBInstance.create(':memory:', settings);
  const connection = await db.connect();
  const ownDir = !config.workDir;
  const workDir = config.workDir || mkdtempSync(join(tmpdir(), 'tributary-query-'));
  const objects = new Objects(config, workDir);
  const metadataDb = createDb(config.databaseUrl);

  app.addHook('onClose', async () => {
    connection.closeSync();
    db.closeSync();
    await metadataDb.destroy();
    if (ownDir) rmSync(workDir, { recursive: true, force: true });
  });

  // Every /internal route needs the shared token from apps/api.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/internal/')) return;
    const token = request.headers['x-internal-token'];
    if (typeof token !== 'string' || !same(token, config.internalToken)) {
      return reply.code(401).send({ code: 'unauthenticated', message: 'Missing or invalid internal token.' });
    }
  });

  app.get('/healthz', async () => ({ service: 'query', status: 'ok', version: '0.0.0' }));

  app.get('/v1/select42', async () => {
    const reader = await connection.runAndReadAll('select 42 as answer');
    const [row] = reader.getRowObjectsJson();
    return { answer: Number(row?.answer) };
  });

  registerImportRoutes(app, connection, objects);
  registerQueryRoutes(app, { instance: db, objects, metadataDb, config });
  return app;
}
