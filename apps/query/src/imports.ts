import type { DuckDBConnection } from '@duckdb/node-api';
import {
  ImportRunRequestSchema,
  ImportRunResultSchema,
  ReleaseReadRequestSchema,
  ReleasePreviewSchema,
  type ImportRunResult,
} from '@tributary/contracts';
import { dropImport, ImportError, runImport } from '@tributary/importers';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { DUCKDB_SAFE_COLUMN, serial } from './util.ts';
import type { Objects } from './objects.ts';

/** Importer executor and release reader (SPEC M5). Called by apps/api only. */
export function registerImportRoutes(app: FastifyInstance, conn: DuckDBConnection, objects: Objects): void {
  app.post('/internal/imports', async (request, reply) => {
    const parsed = ImportRunRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'invalid', message: parsed.error.message });
    const body = parsed.data;
    const id = randomUUID();
    const sourcePath = objects.path('imports', id, body.source.name.replace(/[^A-Za-z0-9._-]/g, '_'));
    const parquetPath = objects.path('imports', id, 'release.parquet');
    try {
      await objects.download(body.source.bucket, body.source.key, sourcePath);
      // One import at a time on the shared connection (temp tables are per connection).
      return await serial(async () => {
        let result;
        try {
          result = await runImport(conn, body.importer, sourcePath, {
            experimentVersionId: body.context.experiment_version_id,
            programId: body.context.program_id,
            runs: body.context.runs,
            contrast: body.context.contrast,
            contrasts: body.context.contrasts,
            options: body.context.options,
          });
        } catch (error) {
          if (error instanceof ImportError)
            return reply.code(422).send({ code: error.code, message: error.message });
          throw error;
        }
        try {
          let output: ImportRunResult['output'] = null;
          if (result.passed) {
            await conn.run(
              `COPY (SELECT * FROM ${result.table}) TO '${parquetPath}' (FORMAT parquet, COMPRESSION zstd)`,
            );
            const stored = await objects.upload(body.output.bucket, body.output.key, parquetPath);
            output = { format: 'parquet', bucket: body.output.bucket, key: body.output.key, ...stored };
          }
          const { table: _table, ...rest } = result;
          return ImportRunResultSchema.parse({ ...rest, output });
        } finally {
          await dropImport(conn, result);
        }
      });
    } finally {
      rmSync(objects.path('imports', id), { recursive: true, force: true });
    }
  });

  // DuckDB reads a release object (Phase 12 replaces this with the QuerySpec compiler).
  app.post('/internal/releases/read', async (request, reply) => {
    const parsed = ReleaseReadRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: 'invalid', message: parsed.error.message });
    const { storage, limit, order_by } = parsed.data;
    const file = await objects.cached(storage.bucket, storage.key, storage.sha256);
    const order = (order_by ?? []).filter((c) => DUCKDB_SAFE_COLUMN.test(c)).map((c) => `"${c}"`);
    return serial(async () => {
      const count = await conn.runAndReadAll('SELECT count(*) FROM read_parquet($file)', { file });
      const rows = await conn.runAndReadAll(
        `SELECT * FROM read_parquet($file)${order.length ? ` ORDER BY ${order.join(', ')}` : ''} LIMIT $limit`,
        { file, limit },
      );
      return ReleasePreviewSchema.parse({
        row_count: Number(count.getRows()[0]![0]),
        rows: rows.getRowObjectsJson(),
      });
    });
  });
}
