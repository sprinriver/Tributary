import { DuckDBInstance } from '@duckdb/node-api';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { loadQueryConfig, type QueryConfig } from './config.ts';
import { registerImportRoutes } from './imports.ts';
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
  const app = Fastify(options.server ?? {});
  const db = await DuckDBInstance.create(':memory:');
  const connection = await db.connect();
  const ownDir = !config.workDir;
  const workDir = config.workDir || mkdtempSync(join(tmpdir(), 'tributary-query-'));
  const objects = new Objects(config, workDir);

  app.addHook('onClose', async () => {
    connection.closeSync();
    db.closeSync();
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
  return app;
}
