import { ident, literal, na, num, split } from '../sql.ts';
import type { BuiltImport, ImportContext, SourceTable } from '../types.ts';
import { runColumns } from './detect.ts';
import { mapRuns } from './map.ts';
import { ambiguousRule, runsRule } from './rules.ts';

const NA_TOKENS = [''];

export function buildPgMatrix(source: SourceTable, ctx: ImportContext, prefix: string): BuiltImport {
  const runs = mapRuns(runColumns(source.columns), ctx.runs ?? []);
  const runsTable = `${prefix}_runs`;
  const values = runs.map((_, i) => `($c${i}, $r${i}, $s${i}, $n${i})`).join(', ');
  const params: Record<string, string | number | null> = {};
  runs.forEach((r, i) => {
    params[`c${i}`] = r.column;
    params[`r${i}`] = r.instrumentRun;
    params[`s${i}`] = r.sampleKey;
    params[`n${i}`] = r.candidates.length;
  });
  const value = na('value', NA_TOKENS);
  const intensity = num(value, source.decimal);
  const genes = source.columns.includes('Genes') ? ident('Genes') : 'NULL';
  return {
    setup: [
      {
        sql: `CREATE OR REPLACE TEMP TABLE ${runsTable} (run_col VARCHAR, instrument_run VARCHAR, sample_key VARCHAR, candidates INTEGER); INSERT INTO ${runsTable} VALUES ${values}`,
        params,
      },
    ],
    // Empty cells stay as rows with a null intensity (DIA-NN omits zero quantities; nothing is imputed or dropped).
    select: `
      WITH long AS (
        SELECT ${ident('Protein.Group')} AS pg, ${genes} AS genes, run_col, value
        FROM ${source.table} UNPIVOT INCLUDE NULLS (value FOR run_col IN (${runs.map((r) => ident(r.column)).join(', ')}))
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
        NULL::DOUBLE AS q_value,
        NULL::INTEGER AS n_precursors,
        false AS is_imputed,
        ${literal('DIA-NN normalised (QuantUMS or MaxLFQ)')} AS normalisation
      FROM long JOIN ${runsTable} r USING (run_col)`,
    params: { ev: ctx.experimentVersionId ?? null },
    rules: [runsRule(runsTable), ambiguousRule(runsTable)],
    transformations: [
      {
        step: 'melt',
        detail: `${runs.length} run columns → one row per protein group × run; empty cells kept as null intensity`,
      },
      {
        step: 'map_runs',
        detail:
          'Run column (raw file path) → instrument_run (file name without extension) → manifest sample_key',
      },
      { step: 'split', detail: 'protein_ids = Protein.Group split on ";"; gene_names = Genes split on ";"' },
      { step: 'derive', detail: 'log2_intensity = log2(intensity) where intensity > 0' },
    ],
    naTokens: NA_TOKENS,
    toolVersion: typeof ctx.options?.tool_version === 'string' ? ctx.options.tool_version : 'unknown',
    mapping: { protein_group: 'Protein.Group', gene_names: 'Genes', intensity: '<run columns>' },
  };
}
