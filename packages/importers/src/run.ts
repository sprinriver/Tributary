import { DATASET_CONTRACTS } from '@tributary/contracts';
import type { DuckDBConnection } from '@duckdb/node-api';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { ImportError } from './errors.ts';
import { IMPORTERS } from './registry.ts';
import { contractAssertions, evaluate, importerAssertions, parseAssertions } from './rules.ts';
import { DUCKDB_TYPES, ident } from './sql.ts';
import { columnStats } from './stats.ts';
import type { ImportContext, ImportResult, SourceTable } from './types.ts';

let counter = 0;

function firstLine(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buffer, 0, buffer.length, 0);
    return (
      buffer
        .subarray(0, n)
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)[0] ?? ''
    );
  } finally {
    closeSync(fd);
  }
}

function readMagic(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(4);
    readSync(fd, buffer, 0, 4, 0);
    return buffer.toString('latin1');
  } finally {
    closeSync(fd);
  }
}

/** Delimiter from the extension, else the most frequent of tab, semicolon and comma in the header line. */
export function detectDelimiter(path: string, header: string): string {
  if (/\.csv$/i.test(path)) return header.includes(';') && !header.includes(',') ? ';' : ',';
  if (/\.(tsv|tab)$/i.test(path)) return '\t';
  const count = (c: string) => header.split(c).length - 1;
  return ['\t', ';', ','].reduce((best, c) => (count(c) > count(best) ? c : best), '\t');
}

/** Parquet → temp table with scalars as VARCHAR and lists as VARCHAR[] (importers map text, as for CSV). */
async function loadParquet(conn: DuckDBConnection, path: string, table: string): Promise<SourceTable> {
  const described = (
    await conn.runAndReadAll(
      'SELECT column_name, column_type FROM (DESCRIBE SELECT * FROM read_parquet($path))',
      { path },
    )
  ).getRows();
  const lists = described.filter((r) => String(r[1]).endsWith('[]')).map((r) => String(r[0]));
  const casts = described.map((r) => {
    const name = String(r[0]);
    return `CAST(${ident(name)} AS ${lists.includes(name) ? 'VARCHAR[]' : 'VARCHAR'}) AS ${ident(name)}`;
  });
  await conn.run(
    `CREATE OR REPLACE TEMP TABLE ${table} AS SELECT ${casts.join(', ')} FROM read_parquet($path)`,
    { path },
  );
  return { table, columns: described.map((r) => String(r[0])), delimiter: 'parquet', decimal: '.', lists };
}

const MAX_JSON_BYTES = 200 * 1024 * 1024;

/** Loads a file as an all-text temp table (delimited or Parquet) or a parsed JSON document. */
export async function loadSource(
  conn: DuckDBConnection,
  path: string,
  prefix: string,
  input: 'table' | 'json' = 'table',
): Promise<SourceTable> {
  const table = `${prefix}_src`;
  if (input === 'json') {
    if (statSync(path).size > MAX_JSON_BYTES)
      throw new ImportError('too_large', 'JSON inputs are limited to 200 MB.');
    try {
      return {
        table,
        columns: [],
        delimiter: 'json',
        decimal: '.',
        json: JSON.parse(readFileSync(path, 'utf8')),
      };
    } catch {
      throw new ImportError('unreadable', 'The file is not valid JSON.');
    }
  }
  if (/\.parquet$/i.test(path) || readMagic(path) === 'PAR1') return loadParquet(conn, path, table);
  const delimiter = detectDelimiter(path, firstLine(path));
  try {
    await conn.run(
      `CREATE OR REPLACE TEMP TABLE ${table} AS SELECT * FROM read_csv($path, delim = $delim, header = true, all_varchar = true, quote = '"', escape = '"')`,
      { path, delim: delimiter },
    );
  } catch (error) {
    throw new ImportError(
      'unreadable',
      `The file could not be read as a delimited table: ${(error as Error).message.split('\n')[0]}`,
    );
  }
  const columns = (await conn.runAndReadAll(`SELECT column_name FROM (DESCRIBE ${table})`))
    .getRows()
    .map((r) => String(r[0]));
  // Header names become quoted SQL identifiers; control characters (e.g. NUL in binary files) cannot be quoted.
  // eslint-disable-next-line no-control-regex
  if (columns.some((c) => /[\u0000-\u001f\u007f]/.test(c))) {
    await conn.run(`DROP TABLE IF EXISTS ${table}`);
    throw new ImportError('unreadable', 'The header has control characters; the file is not a text table.');
  }
  let decimal: '.' | ',' = '.';
  if (delimiter !== ',') {
    const parts = columns.flatMap((c) => [
      `count(*) FILTER (WHERE regexp_full_match(trim(${ident(c)}), '-?[0-9]+,[0-9]+([eE][-+]?[0-9]+)?'))`,
      `count(*) FILTER (WHERE regexp_full_match(trim(${ident(c)}), '-?[0-9]+\\.[0-9]+([eE][-+]?[0-9]+)?'))`,
    ]);
    const row = (await conn.runAndReadAll(`SELECT ${parts.join(', ')} FROM ${table}`)).getRows()[0]!;
    let comma = 0;
    let dot = 0;
    row.forEach((v, i) => (i % 2 ? (dot += Number(v)) : (comma += Number(v))));
    if (comma > 0 && dot === 0) decimal = ',';
  }
  return { table, columns, delimiter, decimal };
}

/**
 * Runs one importer over a local file: load → map to canonical columns (DuckDB SQL from the importer) → contract
 * types → quality rules → column stats. The canonical rows stay in a temp table (`result.table`) for the caller to
 * write as a release; nothing is written when rules fail.
 */
export async function runImport(
  conn: DuckDBConnection,
  key: string,
  path: string,
  ctx: ImportContext,
): Promise<ImportResult> {
  const importer = IMPORTERS[key];
  if (!importer) throw new ImportError('unknown_importer', `No importer named ${key}.`);
  const prefix = `imp${++counter}`;
  const source = await loadSource(conn, path, prefix, importer.input);
  const built = importer.build(source, ctx, prefix);
  const kind = built.kind ?? importer.kind;
  const contract = DATASET_CONTRACTS[kind];
  for (const step of built.setup) await conn.run(step.sql, step.params ?? {});

  const work = `${prefix}_work`;
  const canon = `${prefix}_canon`;
  await conn.run(`CREATE OR REPLACE TEMP TABLE ${work} AS ${built.select}`, built.params);
  const workColumns = new Set(
    (await conn.runAndReadAll(`SELECT column_name FROM (DESCRIBE ${work})`))
      .getRows()
      .map((r) => String(r[0])),
  );
  const missing = contract.columns.filter((c) => !workColumns.has(c.name)).map((c) => c.name);
  if (missing.length) throw new Error(`Importer ${key} did not produce: ${missing.join(', ')}`);
  const casts = contract.columns.map(
    (c) => `CAST(${ident(c.name)} AS ${DUCKDB_TYPES[c.type]}) AS ${ident(c.name)}`,
  );
  await conn.run(`CREATE OR REPLACE TEMP TABLE ${canon} AS SELECT ${casts.join(', ')} FROM ${work}`);

  const failures = await evaluate(conn, [
    ...parseAssertions(contract, work, workColumns),
    ...contractAssertions(contract, canon),
    ...importerAssertions(built.rules, work, canon),
  ]);
  const rowCount = Number((await conn.runAndReadAll(`SELECT count(*) FROM ${canon}`)).getRows()[0]![0]);
  const stats = await columnStats(conn, contract, canon);
  await conn.run(`DROP TABLE IF EXISTS ${work}; DROP TABLE IF EXISTS ${source.table}`);

  return {
    importer: importer.key,
    kind,
    contract_version: contract.version,
    passed: !failures.some((f) => f.severity === 'error'),
    row_count: rowCount,
    failures,
    column_stats: stats,
    transformations: [
      ...(source.decimal === ','
        ? [{ step: 'decimal_comma', detail: 'Numbers used "," as the decimal mark; converted to "."' }]
        : []),
      ...built.transformations,
    ],
    source: {
      importer: importer.key,
      importer_version: importer.version,
      tool: importer.tool,
      tool_version: built.toolVersion,
      original_columns: source.columns,
      delimiter: source.delimiter,
      decimal: source.decimal,
      na_tokens: built.naTokens,
      ...(built.mapping ? { mapping: built.mapping } : {}),
    },
    table: canon,
  };
}

/** Importers whose header signature matches the file. */
export async function detectImporters(conn: DuckDBConnection, path: string): Promise<string[]> {
  const prefix = `det${++counter}`;
  let source: SourceTable;
  try {
    source = await loadSource(conn, path, prefix);
  } catch {
    return [];
  }
  await conn.run(`DROP TABLE IF EXISTS ${source.table}`);
  return Object.values(IMPORTERS)
    .filter((i) => i.detect(source.columns))
    .map((i) => i.key);
}

export type CanonicalRow = Record<string, unknown>;

/** Canonical rows in a deterministic order, JSON columns parsed. */
export async function canonicalRows(conn: DuckDBConnection, result: ImportResult): Promise<CanonicalRow[]> {
  const json = DATASET_CONTRACTS[result.kind].columns.filter((c) => c.type === 'json').map((c) => c.name);
  const rows = (await conn.runAndReadAll(`SELECT * FROM ${result.table} ORDER BY ALL`)).getRowObjectsJson();
  return rows.map((row) => {
    const out: CanonicalRow = { ...row };
    for (const name of json) if (typeof out[name] === 'string') out[name] = JSON.parse(out[name] as string);
    return out;
  });
}

/** sha256 of the canonical rows (golden tests). */
export const rowsHash = (rows: CanonicalRow[]) =>
  createHash('sha256').update(JSON.stringify(rows)).digest('hex');

export async function dropImport(conn: DuckDBConnection, result: ImportResult): Promise<void> {
  await conn.run(`DROP TABLE IF EXISTS ${result.table}`);
}
