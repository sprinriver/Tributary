import { ImportError } from '../errors.ts';
import type { Importer } from '../types.ts';
import { isTopTable } from './detect.ts';
import { buildTopTable } from './sql.ts';

/** limma `topTable(…, confint = TRUE)` for one contrast → differential_abundance (SOURCE.md). */
export const limmaTopTable: Importer = {
  key: 'limma_toptable',
  label: 'limma topTable (one contrast)',
  kind: 'differential_abundance',
  tool: 'limma',
  version: '1.0.0',
  formats: ['tsv', 'csv', 'text'],
  detect: isTopTable,
  build(source, ctx) {
    if (!isTopTable(source.columns)) {
      throw new ImportError(
        'wrong_format',
        'This is not a limma topTable: expected logFC, P.Value and adj.P.Val columns.',
      );
    }
    if (!ctx.experimentVersionId)
      throw new ImportError('needs_version', 'limma_toptable imports belong to an experiment version.');
    return buildTopTable(source, ctx);
  },
};
