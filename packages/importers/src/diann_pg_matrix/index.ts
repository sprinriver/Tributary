import { ImportError } from '../errors.ts';
import type { Importer } from '../types.ts';
import { isPgMatrix } from './detect.ts';
import { buildPgMatrix } from './sql.ts';

/** DIA-NN `report.pg_matrix.tsv` → protein_quant (SOURCE.md). */
export const diannPgMatrix: Importer = {
  key: 'diann_pg_matrix',
  label: 'DIA-NN protein-group matrix (report.pg_matrix.tsv)',
  kind: 'protein_quant',
  tool: 'DIA-NN',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: isPgMatrix,
  build(source, ctx, prefix) {
    if (!isPgMatrix(source.columns)) {
      throw new ImportError(
        'wrong_format',
        'This is not a DIA-NN pg_matrix: expected Protein.Group, Protein.Names, Genes and run columns.',
      );
    }
    if (!ctx.experimentVersionId)
      throw new ImportError('needs_version', 'diann_pg_matrix imports belong to an experiment version.');
    return buildPgMatrix(source, ctx, prefix);
  },
};
