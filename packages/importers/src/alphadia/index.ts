import { ImportError } from '../errors.ts';
import { na } from '../sql.ts';
import { buildLong, hasAll } from '../shared/long.ts';
import { buildWide, toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// AlphaDIA outputs (SOURCE.md; alphadia/constants/keys.py, 2.3.2-dev0).
const PRECURSOR_REQUIRED = [
  'raw.name',
  'precursor.sequence',
  'precursor.charge',
  'precursor.intensity',
  'pg.name',
];

export const alphadiaPrecursors: Importer = {
  key: 'alphadia_precursors',
  label: 'AlphaDIA precursors table → precursors',
  kind: 'precursor_quant',
  tool: 'AlphaDIA',
  version: '1.0.0',
  formats: ['tsv', 'parquet', 'text'],
  detect: (c) => hasAll(c, ...PRECURSOR_REQUIRED),
  build(source, ctx, prefix) {
    if (!hasAll(source.columns, ...PRECURSOR_REQUIRED)) {
      throw new ImportError(
        'wrong_format',
        `Not an AlphaDIA precursors table: expected ${PRECURSOR_REQUIRED.join(', ')}.`,
      );
    }
    const mods = source.columns.includes('precursor.mods') ? na('s."precursor.mods"', ['']) : 'NULL';
    const sites = source.columns.includes('precursor.mod_sites')
      ? na('s."precursor.mod_sites"', [''])
      : 'NULL';
    const id = source.columns.includes('precursor.mod_seq_charge_hash')
      ? { column: 'precursor.mod_seq_charge_hash', type: 'text' as const }
      : { sql: `s."precursor.sequence" || '_' || s."precursor.charge"` };
    return buildLong(source, ctx, prefix, {
      runSql: 's."raw.name"',
      columns: {
        precursor_id: id,
        modified_sequence: {
          sql: `CASE WHEN ${mods} IS NULL THEN s."precursor.sequence" ELSE s."precursor.sequence" || ' [' || ${mods} || '@' || coalesce(${sites}, '') || ']' END`,
        },
        charge: { column: 'precursor.charge', type: 'integer' },
        protein_group: { column: 'pg.name', type: 'text' },
        protein_ids: { column: 'pg.name', type: 'text[]' },
        gene_names: { column: 'pg.genes', type: 'text[]' },
        intensity: { column: 'precursor.intensity', type: 'double' },
        q_value: { column: 'precursor.qval', type: 'double' },
        pg_q_value: { column: 'pg.qval', type: 'double' },
        global_q_value: { sql: 'NULL::DOUBLE' },
        // keys.py does not state the unit of precursor.rt.observed: not imported rather than guessed.
        retention_time: { sql: 'NULL::DOUBLE' },
        ion_mobility: { column: 'precursor.mobility.observed', type: 'double' },
      },
      naTokens: [''],
      transformations: [
        {
          step: 'derive',
          detail: 'modified_sequence = precursor.sequence, plus " [mods@sites]" when precursor.mods is set',
        },
        { step: 'not_imported', detail: 'precursor.rt.observed (unit not documented) → retention_time null' },
        { step: 'split', detail: 'protein_ids = pg.name and gene_names = pg.genes split on ";"' },
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};

export const alphadiaPgMatrix: Importer = {
  key: 'alphadia_pg_matrix',
  label: 'AlphaDIA protein-group matrix (pg.matrix.tsv)',
  kind: 'protein_quant',
  tool: 'AlphaDIA',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: (c) => c[0] === 'pg' && c.length > 1,
  build(source, ctx, prefix) {
    if (source.columns[0] !== 'pg')
      throw new ImportError('wrong_format', 'Not an AlphaDIA pg matrix: the first column must be "pg".');
    const runs = source.columns.slice(1).map((column) => ({ column, name: column }));
    return buildWide(source, ctx, prefix, {
      groupColumn: 'pg',
      runs,
      naTokens: [''],
      normalisation: null,
      toolVersion: toolVersion(ctx),
      mapping: { protein_group: 'pg', intensity: '<run columns>' },
    });
  },
};
