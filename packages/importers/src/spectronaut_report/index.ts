import { ImportError } from '../errors.ts';
import { na, num } from '../sql.ts';
import { buildLong, hasAll } from '../shared/long.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// Spectronaut long report (SOURCE.md; columns via MSstatsConvert SpectronauttoMSstatsFormat; PG.Quantity unverified).
const REQUIRED = ['R.FileName', 'PG.ProteinGroups', 'PG.Quantity'];
// "Filtered" = removed by Spectronaut's q-value filter; recorded as a transformation, stored as null.
const NA_TOKENS = ['', 'NaN', 'Filtered'];

export const spectronautReport: Importer = {
  key: 'spectronaut_report',
  label: 'Spectronaut report → protein groups',
  kind: 'protein_quant',
  tool: 'Spectronaut',
  version: '1.0.0',
  formats: ['tsv', 'csv', 'text'],
  detect: (c) => hasAll(c, ...REQUIRED),
  build(source, ctx, prefix) {
    if (!hasAll(source.columns, ...REQUIRED)) {
      throw new ImportError('wrong_format', `Not a Spectronaut report: expected ${REQUIRED.join(', ')}.`);
    }
    const keep = [
      'R.FileName',
      'R.Condition',
      'PG.ProteinGroups',
      'PG.Genes',
      'PG.Quantity',
      'PG.Qvalue',
    ].filter((c) => source.columns.includes(c));
    // The report repeats PG.* columns on every fragment row: one row per distinct group × run values.
    const from = `SELECT DISTINCT ${keep.map((c) => `"${c}"`).join(', ')} FROM ${source.table}`;
    const condition = source.columns.includes('R.Condition');
    const q = num(na('s."PG.Quantity"', NA_TOKENS), source.decimal);
    return buildLong(source, ctx, prefix, {
      from,
      runSql: 's."R.FileName"',
      columns: {
        protein_group: { column: 'PG.ProteinGroups', type: 'text' },
        protein_ids: { column: 'PG.ProteinGroups', type: 'text[]' },
        gene_names: { column: 'PG.Genes', type: 'text[]' },
        intensity: { column: 'PG.Quantity', type: 'double' },
        log2_intensity: {
          sql: `CASE WHEN isfinite(${q}) AND ${q} > 0 THEN log2(${q}) END`,
        },
        q_value: { column: 'PG.Qvalue', type: 'double' },
        n_precursors: { sql: 'NULL::INTEGER' },
        is_imputed: { sql: 'false' },
        normalisation: { sql: 'NULL::VARCHAR' },
      },
      naTokens: NA_TOKENS,
      rules: condition
        ? [
            {
              id: 'condition_matches_manifest',
              severity: 'warn',
              source: 'SPEC §6.3 spectronaut_report: cross-check R.Condition against the manifest',
              sql: `SELECT DISTINCT m.run_col || ': ' || s."R.Condition" || ' vs ' || m.condition AS example
                FROM (${from}) s JOIN ${prefix}_runmap m ON m.run_col = s."R.FileName"
                WHERE m.condition IS NOT NULL AND s."R.Condition" IS NOT NULL AND s."R.Condition" <> m.condition`,
              message: (n, ex) =>
                `R.Condition differs from the manifest condition in ${n} run(s): ${ex.join('; ')}.`,
            },
          ]
        : [],
      transformations: [
        {
          step: 'deduplicate',
          detail: `Distinct (${keep.join(', ')}) rows: PG.* values repeat on every fragment row`,
        },
        { step: 'derive', detail: 'log2_intensity = log2(PG.Quantity) where finite and > 0' },
        { step: 'na_tokens', detail: 'PG.Quantity "Filtered" (Spectronaut q-value filter) and "NaN" → null' },
        { step: 'split', detail: 'protein_ids = PG.ProteinGroups and gene_names = PG.Genes split on ";"' },
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};
