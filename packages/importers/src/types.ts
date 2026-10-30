import type { DatasetKind } from '@tributary/contracts';

/** What the caller knows about the import (from Postgres): the version, its manifest runs, the contrast. */
export interface ImportContext {
  experimentVersionId?: string | undefined;
  programId: string;
  /** Manifest rows used to map instrument runs to samples. */
  runs?:
    | {
        sample_key: string;
        instrument_run: string | null;
        raw_file: string | null;
        condition?: string | null | undefined;
      }[]
    | undefined;
  /** The contrast a differential table belongs to; label reads "numerator vs denominator". */
  contrast?: { id: string; label: string } | undefined;
  /** Every registered contrast of the version (tables that hold several comparisons, e.g. MSstats). */
  contrasts?: { id: string; label: string }[] | undefined;
  /** Importer-specific options (e.g. custom_tabular mapping, tool_version). */
  options?: Record<string, unknown> | undefined;
}

/** The source file loaded as an all-text temp table. */
export interface SourceTable {
  table: string;
  columns: string[];
  delimiter: string;
  /** Decimal mark detected in numeric-looking cells. */
  decimal: '.' | ',';
  /** Parsed document for JSON inputs (mzQC); `table` is unused then. */
  json?: unknown;
  /** Parquet list columns (cast to VARCHAR[]); scalars are VARCHAR. */
  lists?: string[];
}

export interface Transformation {
  step: string;
  detail: string;
}

/** An importer-specific check: `sql` selects one text column `example` per failing row. */
export interface ImporterRule {
  id: string;
  severity: 'error' | 'warn';
  source: string;
  sql: string;
  message: (count: number, examples: string[]) => string;
}

export interface BuiltImport {
  /** Target kind when it depends on options (custom_tabular); defaults to the importer's kind. */
  kind?: DatasetKind;
  /** Statements run before `select` (temp tables built from the header or context). */
  setup: { sql: string; params?: Record<string, string | number | boolean | null> }[];
  /**
   * SELECT producing every canonical column (by name), plus `__raw_<column>` text columns holding the source text of
   * typed columns so unparseable values can be reported. `{work}`-style placeholders are not used here.
   */
  select: string;
  params: Record<string, string | number | boolean | null>;
  /** Checks against the work table (`{work}`) or the canonical table (`{canon}`). */
  rules: ImporterRule[];
  transformations: Transformation[];
  naTokens: string[];
  toolVersion: string;
  /** Canonical column → original column, for release metadata. */
  mapping?: Record<string, string>;
}

export interface Importer {
  key: string;
  label: string;
  kind: DatasetKind;
  tool: string;
  version: string;
  /** Formats it reads (from the ingest sniffers). */
  formats: string[];
  /** How the file is loaded: a delimited/Parquet table (default) or a JSON document. */
  input?: 'table' | 'json';
  /** True when the header looks like this tool's output. */
  detect(columns: string[]): boolean;
  build(source: SourceTable, ctx: ImportContext, prefix: string): BuiltImport;
}

export interface RuleFailure {
  rule_id: string;
  severity: 'error' | 'warn';
  failing_rows: number;
  message: string;
  source: string;
  examples: string[];
}

export interface ColumnStats {
  null_count: number;
  distinct_count: number;
  min?: number | string | null;
  max?: number | string | null;
}

export interface ImportResult {
  importer: string;
  kind: DatasetKind;
  contract_version: string;
  passed: boolean;
  row_count: number;
  failures: RuleFailure[];
  column_stats: Record<string, ColumnStats>;
  transformations: Transformation[];
  source: {
    importer: string;
    importer_version: string;
    tool: string;
    tool_version: string;
    original_columns: string[];
    delimiter: string;
    decimal: '.' | ',';
    na_tokens: string[];
    mapping?: Record<string, string>;
  };
  /** Temp table holding the canonical rows on the connection used. */
  table: string;
}
