import { ImportError } from '../errors.ts';
import { buildLong, hasAll } from '../shared/long.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// DIA-NN main report (SOURCE.md; README "Main output reference", 2.x).
const REQUIRED = ['Run', 'Precursor.Id', 'Protein.Group', 'Precursor.Normalised', 'Q.Value'];
const detect = (c: string[]) => hasAll(c, ...REQUIRED);

export const diannReportParquet: Importer = {
  key: 'diann_report_parquet',
  label: 'DIA-NN main report (report.parquet) → precursors',
  kind: 'precursor_quant',
  tool: 'DIA-NN',
  version: '1.0.0',
  formats: ['parquet'],
  detect,
  build(source, ctx, prefix) {
    if (!detect(source.columns))
      throw new ImportError('wrong_format', `Not a DIA-NN report: expected ${REQUIRED.join(', ')}.`);
    return buildLong(source, ctx, prefix, {
      runSql: 's."Run"',
      columns: {
        precursor_id: { column: 'Precursor.Id', type: 'text' },
        modified_sequence: { column: 'Modified.Sequence', type: 'text' },
        charge: { column: 'Precursor.Charge', type: 'integer' },
        protein_group: { column: 'Protein.Group', type: 'text' },
        protein_ids: { column: 'Protein.Group', type: 'text[]' },
        gene_names: { column: 'Genes', type: 'text[]' },
        intensity: { column: 'Precursor.Normalised', type: 'double' },
        q_value: { column: 'Q.Value', type: 'double' },
        pg_q_value: { column: 'PG.Q.Value', type: 'double' },
        global_q_value: { column: 'Global.Q.Value', type: 'double' },
        retention_time: { column: 'RT', type: 'double' },
        ion_mobility: { column: 'IM', type: 'double' },
      },
      naTokens: [],
      transformations: [
        { step: 'split', detail: 'protein_ids = Protein.Group and gene_names = Genes split on ";"' },
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};

export const diannReportQc: Importer = {
  key: 'diann_report_qc',
  label: 'DIA-NN main report (report.parquet) → per-run QC counts',
  kind: 'qc_metrics',
  tool: 'DIA-NN',
  version: '1.0.0',
  formats: ['parquet'],
  detect,
  build(source, ctx) {
    if (!detect(source.columns))
      throw new ImportError('wrong_format', `Not a DIA-NN report: expected ${REQUIRED.join(', ')}.`);
    const min = typeof ctx.options?.min_precursors === 'number' ? ctx.options.min_precursors : null;
    const stem = `regexp_replace(regexp_replace("Run", '^.*[/\\\\]', ''), '\\.(raw|d|wiff2?|mzml|dia)$', '', 'i')`;
    return {
      setup: [],
      select: `
        WITH counts AS (
          SELECT ${stem} AS run, count(DISTINCT "Precursor.Id") AS precursors, count(DISTINCT "Protein.Group") AS groups
          FROM ${source.table} GROUP BY 1
        )
        SELECT $ev::UUID AS experiment_version_id, 'run' AS scope, run AS scope_key, 'precursors' AS metric,
          precursors::DOUBLE AS value, 'count' AS unit, $min::DOUBLE AS threshold,
          CASE WHEN $min IS NULL THEN 'not_assessed' WHEN precursors >= $min THEN 'pass' ELSE 'fail' END AS status
        FROM counts
        UNION ALL
        SELECT $ev::UUID, 'run', run, 'protein_groups', groups::DOUBLE, 'count', NULL::DOUBLE, 'not_assessed' FROM counts`,
      params: { ev: ctx.experimentVersionId ?? null, min },
      rules: [],
      transformations: [
        {
          step: 'aggregate',
          detail:
            'Per run: distinct Precursor.Id (precursors) and Protein.Group (protein_groups) in the report as exported',
        },
        {
          step: 'status',
          detail: min === null ? 'No threshold given: status not_assessed' : `precursors pass when ≥ ${min}`,
        },
      ],
      naTokens: [],
      toolVersion: toolVersion(ctx),
    };
  },
};
