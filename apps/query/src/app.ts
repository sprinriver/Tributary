import { DuckDBInstance } from '@duckdb/node-api';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

/**
 * Internal query service. Phase 0 only proves DuckDB runs in-process; the QuerySpec compiler arrives in Phase 12.
 * One DuckDB instance per process (ARCHITECTURE §6).
 */
export async function buildApp(options: FastifyServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify(options);
  const db = await DuckDBInstance.create(':memory:');
  const connection = await db.connect();

  app.addHook('onClose', async () => {
    connection.closeSync();
    db.closeSync();
  });

  app.get('/healthz', async () => ({ service: 'query', status: 'ok', version: '0.0.0' }));

  app.get('/v1/select42', async () => {
    const reader = await connection.runAndReadAll('select 42 as answer');
    const [row] = reader.getRowObjectsJson();
    return { answer: Number(row?.answer) };
  });

  return app;
}
