import { ImportError } from '../errors.ts';
import { hasAll } from '../shared/long.ts';
import { buildDifferential, featureTypeOf, numericOf } from '../shared/differential.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// DEqMS outputResult (SOURCE.md; man/outputResult.Rd 1.31.0).
const REQUIRED = ['logFC', 'sca.t', 'sca.P.Value', 'sca.adj'];

export const deqmsResult: Importer = {
  key: 'deqms_result',
  label: 'DEqMS outputResult (one contrast)',
  kind: 'differential_abundance',
  tool: 'DEqMS',
  version: '1.0.0',
  formats: ['tsv', 'csv', 'text'],
  detect: (c) => hasAll(c, ...REQUIRED),
  build(source, ctx) {
    if (!hasAll(source.columns, ...REQUIRED))
      throw new ImportError('wrong_format', `Not DEqMS output: expected ${REQUIRED.join(', ')}.`);
    if (!source.columns.includes('gene')) {
      throw new ImportError(
        'no_identifier',
        'DEqMS output has no gene column (outputResult adds it from the row names).',
      );
    }
    const feature = 'gene';
    const p = numericOf(source, ['NA'])('sca.P.Value');
    return buildDifferential(source, ctx, {
      featureColumn: feature,
      featureType: featureTypeOf(ctx),
      numeric: {
        log2_fc: 'logFC',
        ci_low: 'CI.L',
        ci_high: 'CI.R',
        avg_log2_abundance: 'AveExpr',
        t_stat: 'sca.t',
        p_value: 'sca.P.Value',
        adj_p_value: 'sca.adj',
      },
      naReasonSql: `CASE WHEN ${p} IS NULL THEN 'NA in DEqMS output' END`,
      adjMethod: 'BH',
      method: 'DEqMS',
      naTokens: ['NA'],
      transformations: [
        {
          step: 'select_statistics',
          detail:
            'sca.t / sca.P.Value / sca.adj used; limma t / P.Value / adj.P.Val / B kept in the source only',
        },
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};
