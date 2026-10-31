import {
  InternalExportResultSchema,
  QueryExportBodySchema,
  QueryExportSchema,
  QueryResultSchema,
  QuerySpecSchema,
  type InternalQueryRequest,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { insertAudit, requestActor } from '../audit.ts';
import { requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { parse } from '../errors.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { prepare, releaseIds } from '../query/prepare.ts';
import { respond } from '../respond.ts';
import type { Storage } from '../storage.ts';

export function registerQueryRoutes(
  app: FastifyInstance,
  db: Database,
  config: ApiConfig,
  storage: Storage,
  fetchImpl: typeof fetch,
): void {
  app.post('/v1/query', async (request) => {
    requirePrincipal(request);
    const spec = parse(QuerySpecSchema, request.body);
    const sources = await prepare(db, request, spec);
    const result = await callQueryService(fetchImpl, config, '/internal/query', { spec, ...sources });
    return respond(QueryResultSchema, result);
  });

  app.post('/v1/query/export', async (request, reply) => {
    requirePrincipal(request);
    const body = parse(QueryExportBodySchema, request.body);
    const sources = await prepare(db, request, body.spec);
    const { id } = await sql<{ id: string }>`select uuidv7() as id`.execute(db).then((r) => r.rows[0]!);
    const internal: InternalQueryRequest = {
      spec: body.spec,
      ...sources,
      export: { format: body.format, bucket: config.s3.workBucket, key: `exports/${id}.${body.format}` },
    };
    const done = InternalExportResultSchema.parse(
      await callQueryService(fetchImpl, config, '/internal/query', internal),
    );
    const url = await storage.presignGet(done.key, done.bucket);
    await insertAudit(db, requestActor(request), {
      action: 'query.export',
      entityType: 'query_export',
      entityId: id,
      after: {
        format: body.format,
        row_count: done.row_count,
        sql_hash: done.sql_hash,
        release_ids: releaseIds(internal),
        key: done.key,
        spec: body.spec,
      },
    });
    reply.code(201);
    return respond(QueryExportSchema, {
      url,
      expires_at: new Date(Date.now() + config.s3.presignTtlSeconds * 1000).toISOString(),
      format: body.format,
      row_count: done.row_count,
      sql_hash: done.sql_hash,
    });
  });
}
