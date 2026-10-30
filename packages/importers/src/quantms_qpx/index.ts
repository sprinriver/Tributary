import { ImportError } from '../errors.ts';
import { removedRowsRule } from '../shared/runs.ts';
import { buildLong, hasAll } from '../shared/long.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// quantms QPX pg structure (SOURCE.md; qpx/core/data/schemas/pg.yaml).
const REQUIRED = ['pg_accessions', 'grouped_runs', 'intensity'];

export const quantmsQpx: Importer = {
  key: 'quantms_qpx',
  label: 'quantms QPX protein groups (pg Parquet)',
  kind: 'protein_quant',
  tool: 'quantms (QPX)',
  version: '1.0.0',
  formats: ['parquet'],
  detect: (c) => hasAll(c, ...REQUIRED),
  build(source, ctx, prefix) {
    if (!hasAll(source.columns, ...REQUIRED) || !source.lists?.includes('pg_accessions')) {
      throw new ImportError(
        'wrong_format',
        'Not a QPX pg file: expected list columns pg_accessions and grouped_runs, and intensity.',
      );
    }
    const keep = ctx.options?.keep_flagged === true;
    const flags = ['is_decoy', 'contaminant'].filter((c) => source.columns.includes(c));
    const flagged = flags.map((f) => `coalesce(TRY_CAST("${f}" AS BOOLEAN), false)`).join(' OR ') || 'false';
    const from = `SELECT * FROM ${source.table}${keep ? '' : ` WHERE NOT (${flagged})`}`;
    const genes = source.columns.includes('gg_names') ? 's."gg_names"' : '[]::VARCHAR[]';
    const built = buildLong(source, ctx, prefix, {
      from,
      runSql: 's."grouped_runs"[1]',
      columns: {
        protein_group: { sql: `array_to_string(s."pg_accessions", ';')` },
        protein_ids: { sql: 's."pg_accessions"' },
        gene_names: { sql: `coalesce(${genes}, []::VARCHAR[])` },
        intensity: { column: 'intensity', type: 'double' },
        log2_intensity: {
          sql: `CASE WHEN TRY_CAST(s."intensity" AS DOUBLE) > 0 THEN log2(TRY_CAST(s."intensity" AS DOUBLE)) END`,
        },
        q_value: { column: 'pg_qvalue', type: 'double' },
        n_precursors: { sql: 'NULL::INTEGER' },
        is_imputed: { sql: 'false' },
        normalisation: { sql: 'NULL::VARCHAR' },
      },
      naTokens: [],
      rules: [
        {
          id: 'single_run_unit',
          severity: 'error',
          source:
            'QPX pg.yaml grouped_runs: single-element for unfractionated/DIA; fractions are not supported yet',
          sql: `SELECT array_to_string("grouped_runs", ',') AS example FROM ${source.table} WHERE len("grouped_runs") <> 1`,
          message: (n, ex) =>
            `${n} row(s) combine several runs (fractions), which this importer does not support yet: ${ex.join('; ')}.`,
        },
        ...(!keep && flags.length
          ? [
              removedRowsRule(
                'flagged_rows_removed',
                'QPX pg.yaml is_decoy / contaminant flags',
                `SELECT array_to_string("pg_accessions", ';') AS example FROM ${source.table} WHERE ${flagged}`,
                'decoy/contaminant row(s)',
              ),
            ]
          : []),
      ],
      transformations: [
        {
          step: 'derive',
          detail: 'protein_group = pg_accessions joined with ";"; log2_intensity = log2(intensity) where > 0',
        },
        ...(!keep && flags.length
          ? [
              {
                step: 'filter',
                detail: `Rows with ${flags.join(' or ')} = true removed (count in flagged_rows_removed)`,
              },
            ]
          : []),
      ],
      toolVersion: toolVersion(ctx),
    });
    built.mapping = {
      ...built.mapping,
      protein_ids: 'pg_accessions',
      gene_names: 'gg_names',
      instrument_run: 'grouped_runs[1]',
    };
    return built;
  },
};
