import type { ColumnType, DatasetContract } from '@tributary/contracts';
import type { DuckDBType, DuckDBValue } from '@duckdb/node-api';

/** Contract column type → DuckDB type (releases are written with these types; metadata tables are cast to them). */
export const DUCKDB_TYPE: Readonly<Record<ColumnType, string>> = {
  text: 'VARCHAR',
  uuid: 'UUID',
  double: 'DOUBLE',
  integer: 'INTEGER',
  date: 'DATE',
  timestamp: 'TIMESTAMPTZ',
  boolean: 'BOOLEAN',
  'text[]': 'VARCHAR[]',
  'double[]': 'DOUBLE[]',
  json: 'JSON',
};

/**
 * One source of a query after program scoping: the contract plus either release Parquet files (local cache paths
 * written by the service, never user input) or a temp table the service loaded (metadata kinds).
 */
export interface SourceInput {
  contract: DatasetContract;
  files?: string[];
  table?: string;
}

/** The primary source and one input per join, in `spec.joins` order. */
export interface Sources {
  source: SourceInput;
  joins: SourceInput[];
}

export interface OutputColumn {
  name: string;
  type: ColumnType;
}

export interface CompiledQuery {
  /** Full SELECT with ORDER BY (deterministic: release file + row number break ties); no LIMIT/OFFSET. */
  sql: string;
  /** Same rows without ORDER BY, for counting. */
  countSql: string;
  params: Record<string, DuckDBValue>;
  types: Record<string, DuckDBType>;
  columns: OutputColumn[];
  sqlHash: string;
}

/** A spec the compiler refuses; `field` is the spec path (e.g. `where.rules.0.field`). */
export class CompileError extends Error {
  readonly code: string;
  readonly field: string;
  constructor(code: string, field: string, message: string) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

/** Double-quoted identifier. Names reaching here already matched `^[a-z][a-z0-9_]*$` (contract or spec schema). */
export const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
