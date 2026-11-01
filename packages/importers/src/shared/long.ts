import type { ColumnType } from '@tributary/contracts';
import { ident, na, typed } from '../sql.ts';
import type { BuiltImport, ImportContext, ImporterRule, SourceTable, Transformation } from '../types.ts';
import { runMatching } from './runs.ts';

/** A canonical column: a source column (typed with the contract type) or an SQL expression over the rows `s`. */
export type ColumnSource = { column: string; type: ColumnType; separator?: string } | { sql: string };

export interface LongSpec {
  /** Rows to read, as SQL (default: the source table); referenced as `s`. */
  from?: string;
  /** SQL expression (over `s`) giving each row's run name; omit for tables without runs. */
  runSql?: string;
  columns: Record<string, ColumnSource>;
  naTokens: string[];
  rules?: ImporterRule[];
  transformations: Transformation[];
  toolVersion: string;
  setup?: BuiltImport['setup'];
  params?: BuiltImport['params'];
}

/** One output row per source row (optionally joined to the manifest by run), columns typed per contract. */
export function buildLong(
  source: SourceTable,
  ctx: ImportContext,
  prefix: string,
  spec: LongSpec,
): BuiltImport {
  const from = spec.from ? `(${spec.from})` : source.table;
  const matching = spec.runSql
    ? runMatching(prefix, `SELECT DISTINCT ${spec.runSql} AS name FROM ${from} s`, ctx)
    : null;
  const mapping: Record<string, string> = {};
  const exprs: string[] = [];
  if (matching) {
    exprs.push('$ev::UUID AS experiment_version_id', 'r.sample_key', 'r.instrument_run');
  }
  for (const [name, src] of Object.entries(spec.columns)) {
    if ('sql' in src) {
      exprs.push(`${src.sql} AS ${ident(name)}`);
      continue;
    }
    if (!source.columns.includes(src.column)) {
      exprs.push(`NULL AS ${ident(name)}`);
      continue;
    }
    mapping[name] = src.column;
    const raw = source.lists?.includes(src.column)
      ? `s.${ident(src.column)}`
      : na(`s.${ident(src.column)}`, spec.naTokens);
    if (source.lists?.includes(src.column)) {
      exprs.push(`${raw} AS ${ident(name)}`);
    } else {
      exprs.push(`${typed(raw, src.type, source.decimal, src.separator ?? ';')} AS ${ident(name)}`);
      if (src.type !== 'text' && !src.type.endsWith('[]')) exprs.push(`${raw} AS ${ident(`__raw_${name}`)}`);
    }
  }
  return {
    setup: [...(spec.setup ?? []), ...(matching?.setup ?? [])],
    select: `SELECT ${exprs.join(',\n  ')} FROM ${from} s${
      matching ? ` JOIN ${matching.table} r ON r.run_col = ${spec.runSql}` : ''
    }`,
    params: { ...(matching ? { ev: ctx.experimentVersionId ?? null } : {}), ...spec.params },
    rules: [...(matching?.rules ?? []), ...(spec.rules ?? [])],
    transformations: [
      ...(matching
        ? [
            {
              step: 'map_runs',
              detail: 'Run name → manifest sample (sample_key, instrument_run or raw_file name)',
            },
          ]
        : []),
      ...spec.transformations,
    ],
    naTokens: spec.naTokens,
    toolVersion: spec.toolVersion,
    mapping,
  };
}

/** `has(source, …columns)` — header check for detect(). */
export const hasAll = (columns: string[], ...required: string[]) =>
  required.every((c) => columns.includes(c));
