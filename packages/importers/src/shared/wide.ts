import { ident, literal, na, num, split } from '../sql.ts';
import type { BuiltImport, ImportContext, SourceTable } from '../types.ts';
import { runMatching } from './runs.ts';

export interface WideSpec {
  /** Column holding the protein group (kept verbatim). */
  groupColumn: string;
  genesColumn?: string | undefined;
  /** Quantity columns and the run/sample name each one stands for. */
  runs: { column: string; name: string }[];
  naTokens: string[];
  normalisation: string | null;
  qValueSql?: string | undefined;
  /** Extra WHERE on the source rows (flag filters), documented by the caller's transformations. */
  where?: string | undefined;
  /** Note recorded for zero quantities (tools that write 0 for "not quantified"). */
  zeros?: string | undefined;
  toolVersion: string;
  mapping: Record<string, string>;
}

/** Wide protein matrix (one column per run/sample) → protein_quant, keeping empty cells as null rows. */
export function buildWide(
  source: SourceTable,
  ctx: ImportContext,
  prefix: string,
  spec: WideSpec,
): BuiltImport {
  const names = `${prefix}_names`;
  const params: Record<string, string> = {};
  const values = spec.runs
    .map((r, i) => {
      params[`wc${i}`] = r.column;
      params[`wn${i}`] = r.name;
      return `($wc${i}, $wn${i})`;
    })
    .join(', ');
  const matching = runMatching(prefix, `SELECT name FROM ${names}`, ctx);
  const value = na('value', spec.naTokens);
  const intensity = num(value, source.decimal);
  const genes =
    spec.genesColumn && source.columns.includes(spec.genesColumn) ? ident(spec.genesColumn) : 'NULL';
  return {
    setup: [
      {
        sql: `CREATE OR REPLACE TEMP TABLE ${names} (run_column VARCHAR, name VARCHAR); INSERT INTO ${names} VALUES ${values}`,
        params,
      },
      ...matching.setup,
    ],
    select: `
      WITH src AS (SELECT * FROM ${source.table}${spec.where ? ` WHERE ${spec.where}` : ''}),
      long AS (
        SELECT ${ident(spec.groupColumn)} AS pg, ${genes} AS genes, ${spec.qValueSql ?? 'NULL'} AS q, run_column, value
        FROM src UNPIVOT INCLUDE NULLS (value FOR run_column IN (${spec.runs.map((r) => ident(r.column)).join(', ')}))
      )
      SELECT
        $ev::UUID AS experiment_version_id,
        r.sample_key,
        r.instrument_run,
        long.pg AS protein_group,
        ${split('long.pg')} AS protein_ids,
        ${split('long.genes')} AS gene_names,
        ${intensity} AS intensity,
        ${value} AS __raw_intensity,
        CASE WHEN ${intensity} > 0 THEN log2(${intensity}) END AS log2_intensity,
        ${num('long.q', source.decimal)} AS q_value,
        NULL::INTEGER AS n_precursors,
        false AS is_imputed,
        ${spec.normalisation === null ? 'NULL::VARCHAR' : literal(spec.normalisation)} AS normalisation
      FROM long JOIN ${names} n USING (run_column) JOIN ${matching.table} r ON r.run_col = n.name`,
    params: { ev: ctx.experimentVersionId ?? null },
    rules: matching.rules,
    transformations: [
      {
        step: 'melt',
        detail: `${spec.runs.length} quantity columns → one row per protein group × run; empty cells kept as null`,
      },
      {
        step: 'map_runs',
        detail: 'Column name → manifest sample (sample_key, instrument_run or raw_file name)',
      },
      {
        step: 'split',
        detail: `protein_ids = ${spec.groupColumn} split on ";"${spec.genesColumn ? `; gene_names = ${spec.genesColumn} split on ";"` : ''}`,
      },
      { step: 'derive', detail: 'log2_intensity = log2(intensity) where intensity > 0' },
      ...(spec.zeros ? [{ step: 'zeros', detail: spec.zeros }] : []),
    ],
    naTokens: spec.naTokens,
    toolVersion: spec.toolVersion,
    mapping: spec.mapping,
  };
}

export const toolVersion = (ctx: ImportContext) =>
  typeof ctx.options?.tool_version === 'string' ? ctx.options.tool_version : 'unknown';
