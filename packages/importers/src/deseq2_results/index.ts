import { ImportError } from '../errors.ts';
import { hasAll } from '../shared/long.ts';
import { buildDifferential, numericOf } from '../shared/differential.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// DESeq2 results (SOURCE.md; man/results.Rd and the vignette's "Note on p-values set to NA", 1.53.6).
const REQUIRED = ['baseMean', 'log2FoldChange', 'pvalue', 'padj'];

export const deseq2Results: Importer = {
  key: 'deseq2_results',
  label: 'DESeq2 results (one contrast)',
  kind: 'differential_abundance',
  tool: 'DESeq2',
  version: '1.0.0',
  formats: ['csv', 'tsv', 'text'],
  detect: (c) => hasAll(c, ...REQUIRED),
  build(source, ctx) {
    if (!hasAll(source.columns, ...REQUIRED))
      throw new ImportError('wrong_format', `Not DESeq2 results: expected ${REQUIRED.join(', ')}.`);
    const feature = source.columns[0]!;
    if (REQUIRED.includes(feature) || feature === 'lfcSE' || feature === 'stat') {
      throw new ImportError(
        'no_identifier',
        'The results have no gene identifier column; write them with write.csv(as.data.frame(res)).',
      );
    }
    const value = numericOf(source, ['NA']);
    const lrt = ctx.options?.test === 'LRT';
    return buildDifferential(source, ctx, {
      featureColumn: feature,
      featureType: 'gene',
      numeric: {
        log2_fc: 'log2FoldChange',
        se: 'lfcSE',
        ...(lrt ? {} : { t_stat: 'stat' }),
        p_value: 'pvalue',
        adj_p_value: 'padj',
      },
      naReasonSql: `CASE
        WHEN ${value('baseMean')} = 0 THEN 'DESeq2: all counts zero'
        WHEN ${value('pvalue')} IS NULL THEN 'DESeq2: count outlier (Cook''s distance)'
        WHEN ${value('padj')} IS NULL THEN 'DESeq2: removed by independent filtering'
      END`,
      adjMethod: typeof ctx.options?.adj_method === 'string' ? ctx.options.adj_method : 'BH',
      method: 'DESeq2',
      naTokens: ['NA'],
      transformations: [
        {
          step: 'na_reason',
          detail:
            'NA p-values explained from baseMean / pvalue / padj (DESeq2 vignette, "Note on p-values set to NA")',
        },
        ...(lrt
          ? [{ step: 'not_imported', detail: 'stat is a deviance difference for the LRT: t_stat null' }]
          : []),
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};
