import { ImportError } from '../errors.ts';
import { buildLong, hasAll } from '../shared/long.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// MAGeCK RRA gene_summary.txt (SOURCE.md; MAGeCK wiki "Output file specification").
const REQUIRED = ['id', 'num', 'neg|p-value', 'pos|p-value'];

export const mageckGeneSummary: Importer = {
  key: 'mageck_gene_summary',
  label: 'MAGeCK RRA gene_summary.txt',
  kind: 'crispr_gene_summary',
  tool: 'MAGeCK',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: (c) => hasAll(c, ...REQUIRED),
  build(source, ctx, prefix) {
    if (!hasAll(source.columns, ...REQUIRED)) {
      throw new ImportError(
        'wrong_format',
        `Not a MAGeCK RRA gene summary: expected ${REQUIRED.join(', ')} (mle output is not supported).`,
      );
    }
    const side = (s: 'neg' | 'pos') => ({
      [`${s}_score`]: { column: `${s}|score`, type: 'double' as const },
      [`${s}_p`]: { column: `${s}|p-value`, type: 'double' as const },
      [`${s}_fdr`]: { column: `${s}|fdr`, type: 'double' as const },
      [`${s}_rank`]: { column: `${s}|rank`, type: 'integer' as const },
      [`${s}_lfc`]: { column: `${s}|lfc`, type: 'double' as const },
    });
    return buildLong(source, ctx, prefix, {
      columns: {
        experiment_version_id: { sql: '$ev::UUID' },
        gene: { column: 'id', type: 'text' },
        n_guides: { column: 'num', type: 'integer' },
        ...side('neg'),
        ...side('pos'),
      },
      params: { ev: ctx.experimentVersionId ?? null },
      naTokens: ['NA'],
      transformations: [
        {
          step: 'rename',
          detail: 'neg|… / pos|… columns → neg_… / pos_…; goodsgrna kept in the source only',
        },
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};
