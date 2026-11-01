import type { DuckDBConnection } from '@duckdb/node-api';
import type { ExportFormat, QueryResult } from '@tributary/contracts';
import type { ResultCache } from './semaphore.ts';
import { CompileError, compileQuery, type CompiledQuery, type Sources } from './compiler/index.ts';

/** A query that cannot run: bad cursor, timeout, or a compile error (`status` is the HTTP status for apps/api). */
export class QueryError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | undefined;
  constructor(code: string, message: string, status = 400, field?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

export interface RunOptions {
  /** Per-query timeout (ARCHITECTURE §6: 30 s default). */
  timeoutMs?: number;
  /** Hard cap on rows a spec can reach (pages and exports). */
  rowCap?: number;
  /** Rows counted before `totalCapped` is set. */
  countCap?: number;
  /** Overrides the spec's page size (charts read every row up to this many). */
  pageSize?: number;
  /** Page cache; only pass one when every source is immutable (release files). */
  cache?: ResultCache<QueryResult> | undefined;
}

const DEFAULTS = { timeoutMs: 30_000, rowCap: 1_000_000, countCap: 1_000_000 };

function compile(spec: unknown, sources: Sources): CompiledQuery {
  try {
    return compileQuery(spec, sources);
  } catch (error) {
    if (error instanceof CompileError) throw new QueryError(error.code, error.message, 400, error.field);
    throw error;
  }
}

/** Opaque page cursor bound to the compiled query: a cursor from another spec is refused. */
const encodeCursor = (sqlHash: string, offset: number) =>
  Buffer.from(JSON.stringify({ h: sqlHash, o: offset })).toString('base64url');
function decodeCursor(cursor: string | undefined, sqlHash: string): number {
  if (!cursor) return 0;
  try {
    const { h, o } = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { h?: unknown; o?: unknown };
    if (h === sqlHash && Number.isInteger(o) && (o as number) >= 0) return o as number;
  } catch {
    // Falls through to the error below.
  }
  throw new QueryError(
    'invalid_cursor',
    'This cursor belongs to another query; start from the first page.',
    400,
    'page.cursor',
  );
}

/**
 * Runs `work` (one or more statements) with a deadline. DuckDB ignores an interrupt that arrives between
 * statements, so after the deadline the connection is interrupted repeatedly until the work stops.
 */
async function withTimeout<T>(
  conn: DuckDBConnection,
  timeoutMs: number,
  work: (check: () => void) => Promise<T>,
): Promise<T> {
  let timedOut = false;
  let repeat: ReturnType<typeof setInterval> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    conn.interrupt();
    repeat = setInterval(() => conn.interrupt(), 10);
  }, timeoutMs);
  const fail = () => new QueryError('query_timeout', `The query took longer than ${timeoutMs} ms.`, 408);
  try {
    const result = await work(() => {
      if (timedOut) throw fail();
    });
    if (timedOut) throw fail();
    return result;
  } catch (error) {
    if (timedOut) throw fail();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(repeat);
  }
}

/** One page of a QuerySpec result (SPEC §7.1). */
export async function runQuery(
  conn: DuckDBConnection,
  spec: unknown,
  sources: Sources,
  options: RunOptions = {},
): Promise<QueryResult> {
  const started = performance.now();
  const opts = { ...DEFAULTS, ...options };
  const compiled = compile(spec, sources);
  const page = (spec as { page?: { size?: number; cursor?: string }; limitRows?: number }).page;
  const limitRows = (spec as { limitRows?: number }).limitRows;
  const offset = decodeCursor(page?.cursor, compiled.sqlHash);
  const size = opts.pageSize ?? page?.size ?? 100;
  const cap = Math.min(limitRows ?? Infinity, opts.rowCap);
  const limit = Math.max(0, Math.min(size, cap - offset));
  const key = `${compiled.sqlHash}|${offset}|${limit}|${cap}`;
  const hit = opts.cache?.get(key);
  if (hit) return { ...hit, elapsedMs: Math.round(performance.now() - started) };

  const result = await withTimeout(conn, opts.timeoutMs, async (check) => {
    const counted = await conn.runAndReadAll(
      `SELECT count(*)::BIGINT AS n FROM (${compiled.countSql} LIMIT ${opts.countCap + 1})`,
      compiled.params,
      compiled.types,
    );
    const matching = Number(counted.getRowObjectsJson()[0]?.n ?? 0);
    const total = Math.min(matching, cap, opts.countCap);
    check();
    const reader = await conn.runAndReadAll(
      `${compiled.sql}\nLIMIT ${limit} OFFSET ${offset}`,
      compiled.params,
      compiled.types,
    );
    const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
    const next = offset + rows.length;
    return {
      rows,
      columns: compiled.columns,
      totalRows: total,
      totalCapped: matching > opts.countCap && cap > opts.countCap,
      nextCursor: rows.length === limit && next < total ? encodeCursor(compiled.sqlHash, next) : null,
      sqlHash: compiled.sqlHash,
      elapsedMs: Math.round(performance.now() - started),
    };
  });
  opts.cache?.set(key, result);
  return result;
}

const COPY_OPTIONS: Record<ExportFormat, string> = {
  csv: "FORMAT csv, HEADER true, DELIMITER ','",
  tsv: "FORMAT csv, HEADER true, DELIMITER '\\t'",
  parquet: 'FORMAT parquet, COMPRESSION zstd',
};

/** Writes the whole result (same SQL and order as the pages, capped like them) to a local file. */
export async function exportQuery(
  conn: DuckDBConnection,
  spec: unknown,
  sources: Sources,
  format: ExportFormat,
  file: string,
  options: RunOptions = {},
): Promise<{ row_count: number; sql_hash: string }> {
  const opts = { ...DEFAULTS, ...options };
  const compiled = compile(spec, sources);
  const cap = Math.min((spec as { limitRows?: number }).limitRows ?? Infinity, opts.rowCap);
  // The target path is generated by the service (never user input); quotes are escaped regardless.
  const target = file.replaceAll("'", "''");
  return withTimeout(conn, opts.timeoutMs, async () => {
    const result = await conn.run(
      `COPY (${compiled.sql}\nLIMIT ${cap}) TO '${target}' (${COPY_OPTIONS[format]})`,
      compiled.params,
      compiled.types,
    );
    const counted = result.rowsChanged;
    return { row_count: Number(counted), sql_hash: compiled.sqlHash };
  });
}
