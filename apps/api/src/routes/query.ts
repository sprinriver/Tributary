import {
  checkJoinKeys,
  InternalExportResultSchema,
  QueryExportBodySchema,
  QueryExportSchema,
  QueryResultSchema,
  QuerySpecSchema,
  validateQuerySpec,
  DATASET_CONTRACTS,
  type ContractError,
  type InternalQueryRequest,
  type QuerySpec,
  type ResolvedSource,
  type SourceRef,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import { insertAudit, requestActor } from '../audit.ts';
import { readablePrograms, requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, parse } from '../errors.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { resolveSource } from '../query/resolve.ts';
import { respond } from '../respond.ts';
import type { Storage } from '../storage.ts';

/** Advanced joins (any key pair or operator) need a role above viewer (ARCHITECTURE §6). */
const canUseAdvanced = (request: FastifyRequest) =>
  requirePrincipal(request).bindings.some((b) => b.role !== 'viewer');

/** Scopes every source to the caller's programs, then validates the spec against the resolved contracts. */
async function prepare(db: Database, request: FastifyRequest, spec: QuerySpec) {
  const readable = readablePrograms(requirePrincipal(request));
  const refs: SourceRef[] = [spec.source, ...(spec.joins ?? []).map((j) => j.target)];
  const resolved = await Promise.all(refs.map((ref) => resolveSource(db, ref, readable)));
  const byRef = new Map<SourceRef, ResolvedSource>();
  refs.forEach((ref, i) => resolved[i] && byRef.set(ref, resolved[i]));
  const resolve = (ref: SourceRef) => {
    const source = byRef.get(ref);
    return source ? DATASET_CONTRACTS[source.kind] : undefined;
  };
  const errors: ContractError[] = [
    ...validateQuerySpec(spec, resolve),
    ...checkJoinKeys(spec, resolve, { advancedAllowed: canUseAdvanced(request) }),
  ];
  const [first] = errors;
  if (first) throw new HttpError(400, first.code, first.message, first.field, errors);
  const [source, ...joins] = resolved as ResolvedSource[];
  return { source: source!, joins };
}

const releaseIds = (request: InternalQueryRequest) =>
  [request.source, ...request.joins].flatMap((s) =>
    'releases' in s ? s.releases.map((r) => r.release_id) : [],
  );

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
