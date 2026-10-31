import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import {
  DATASET_CONTRACTS,
  InternalQueryRequestSchema,
  type ExportFormat,
  type QueryResult,
  type ResolvedSource,
} from '@tributary/contracts';
import { readMetadata, type Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { DUCKDB_TYPE, type SourceInput, type Sources } from './compiler/index.ts';
import type { QueryConfig } from './config.ts';
import type { Objects } from './objects.ts';
import { exportQuery, QueryError, runQuery } from './run.ts';
import { ResultCache, Semaphore } from './semaphore.ts';

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  parquet: 'application/vnd.apache.parquet',
};

interface Deps {
  instance: DuckDBInstance;
  objects: Objects;
  metadataDb: Database;
  config: QueryConfig;
}

/** Loads one scoped metadata view into a temp table of this connection (dropped when it closes). */
async function loadMetadata(
  conn: DuckDBConnection,
  deps: Deps,
  source: Extract<ResolvedSource, { metadata: unknown }>,
  scratch: string[],
): Promise<string> {
  const contract = DATASET_CONTRACTS[source.kind];
  const names = contract.columns.map((c) => c.name);
  const rows = await readMetadata(deps.metadataDb, source.kind, names, {
    programIds: source.metadata.program_ids,
    experimentVersionIds: source.metadata.experiment_version_ids,
  });
  const table = `meta_${source.kind}_${randomUUID().replaceAll('-', '')}`;
  const columns = contract.columns.map((c) => `"${c.name}" ${DUCKDB_TYPE[c.type]}`).join(', ');
  await conn.run(`CREATE TEMP TABLE "${table}" (${columns})`);
  if (rows.length) {
    const file = deps.objects.path('meta', `${table}.ndjson`);
    scratch.push(file);
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const struct = contract.columns.map((c) => `'${c.name}': '${DUCKDB_TYPE[c.type]}'`).join(', ');
    await conn.run(
      `INSERT INTO "${table}" SELECT * FROM read_json($file, columns = {${struct}}, format = 'newline_delimited')`,
      { file },
    );
  }
  return table;
}

async function input(
  conn: DuckDBConnection,
  deps: Deps,
  source: ResolvedSource,
  scratch: string[],
): Promise<SourceInput> {
  const contract = DATASET_CONTRACTS[source.kind];
  if ('metadata' in source) return { contract, table: await loadMetadata(conn, deps, source, scratch) };
  const files = await Promise.all(
    source.releases.map((r) => deps.objects.cached(r.storage.bucket, r.storage.key, r.storage.sha256)),
  );
  return { contract, files };
}

/** QuerySpec execution for apps/api (SPEC §7.1): sources arrive already scoped to the caller's programs. */
export function registerQueryRoutes(app: FastifyInstance, deps: Deps): void {
  const semaphore = new Semaphore(deps.config.limits.maxConcurrent);
  const cache = new ResultCache<QueryResult>(200);
  const limits = { timeoutMs: deps.config.limits.timeoutMs, rowCap: deps.config.limits.rowCap };

  app.post('/internal/query', async (request, reply) => {
    const parsed = InternalQueryRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'invalid', message: parsed.error.message });
    const body = parsed.data;
    const scratch: string[] = [];
    try {
      return await semaphore.run(async () => {
        const conn = await deps.instance.connect();
        try {
          const sources: Sources = {
            source: await input(conn, deps, body.source, scratch),
            joins: [],
          };
          for (const join of body.joins) sources.joins.push(await input(conn, deps, join, scratch));
          const immutable = [body.source, ...body.joins].every((s) => 'releases' in s);
          if (!body.export) {
            return await runQuery(conn, body.spec, sources, {
              ...limits,
              cache: immutable ? cache : undefined,
              ...(body.all_rows ? { pageSize: body.all_rows } : {}),
            });
          }
          const { format, bucket, key } = body.export;
          const file = deps.objects.path('exports', `${randomUUID()}.${format}`);
          scratch.push(file);
          const done = await exportQuery(conn, body.spec, sources, format, file, limits);
          await deps.objects.upload(bucket, key, file, CONTENT_TYPE[format]);
          return { row_count: done.row_count, sql_hash: done.sql_hash, bucket, key };
        } finally {
          conn.closeSync();
        }
      });
    } catch (error) {
      if (error instanceof QueryError) {
        return reply
          .code(error.status)
          .send({ code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) });
      }
      throw error;
    } finally {
      for (const file of scratch) rmSync(file, { force: true });
    }
  });
}
