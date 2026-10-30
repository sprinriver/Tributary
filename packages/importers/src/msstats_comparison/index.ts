import { ImportError } from '../errors.ts';
import { ident, na } from '../sql.ts';
import { hasAll } from '../shared/long.ts';
import { buildDifferential, featureTypeOf, numericOf } from '../shared/differential.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// MSstats groupComparison ComparisonResult (SOURCE.md; man/groupComparison.Rd 4.21.1).
const REQUIRED = ['Protein', 'Label', 'log2FC', 'pvalue', 'adj.pvalue'];

export const msstatsComparison: Importer = {
  key: 'msstats_comparison',
  label: 'MSstats groupComparison result',
  kind: 'differential_abundance',
  tool: 'MSstats',
  version: '1.0.0',
  formats: ['csv', 'tsv', 'text'],
  detect: (c) => hasAll(c, ...REQUIRED),
  build(source, ctx, prefix) {
    if (!hasAll(source.columns, ...REQUIRED))
      throw new ImportError('wrong_format', `Not MSstats output: expected ${REQUIRED.join(', ')}.`);
    const labels = `${prefix}_labels`;
    const map = (ctx.options?.label_map ?? {}) as Record<string, string>;
    const contrasts = ctx.contrasts ?? (ctx.contrast ? [ctx.contrast] : []);
    const pairs = contrasts.map((c) => ({
      file: Object.entries(map).find(([, id]) => id === c.id)?.[0] ?? c.label,
      ...c,
    }));
    const params: Record<string, string> = {};
    const values = pairs
      .map((p, i) => {
        params[`lf${i}`] = p.file;
        params[`li${i}`] = p.id;
        params[`ll${i}`] = p.label;
        return `($lf${i}, $li${i}, $ll${i})`;
      })
      .join(', ');
    const base = Number(ctx.options?.log_base ?? 2);
    if (![2, 10, Math.E].includes(base)) throw new ImportError('bad_option', 'log_base must be 2, 10 or e.');
    const value = numericOf(source, ['NA']);
    const label = `(SELECT l.label FROM ${labels} l WHERE l.file_label = s."Label")`;
    const factor = base === 2 ? '' : ` * ${Math.log2(base)}`;
    return buildDifferential(source, ctx, {
      featureColumn: 'Protein',
      featureType: featureTypeOf(ctx),
      numeric: {
        log2_fc: 'log2FC',
        se: 'SE',
        t_stat: 'Tvalue',
        p_value: 'pvalue',
        adj_p_value: 'adj.pvalue',
        missing_pct: 'MissingPercentage',
        imputed_pct: 'ImputationPercentage',
      },
      scale: {
        missing_pct: '({v} * 100)',
        imputed_pct: '({v} * 100)',
        ...(factor ? { log2_fc: `({v}${factor})` } : {}),
      },
      contrastSql: {
        id: `(SELECT l.id FROM ${labels} l WHERE l.file_label = s."Label")::UUID`,
        label: `coalesce(${label}, s."Label")`,
      },
      setup: [
        {
          sql: `CREATE OR REPLACE TEMP TABLE ${labels} (file_label VARCHAR, id VARCHAR, label VARCHAR)${values ? `; INSERT INTO ${labels} VALUES ${values}` : ''}`,
          params,
        },
      ],
      naReasonSql: `CASE
        WHEN ${na('s."issue"', ['NA'])} = 'oneConditionMissing' THEN 'MSstats: one condition missing'
        WHEN ${value('DF')} = 0 THEN 'MSstats: too few observations (DF = 0)'
        WHEN ${value('pvalue')} IS NULL AND ${value('SE')} IS NULL THEN 'MSstats: variance not estimable'
        WHEN ${value('pvalue')} IS NULL THEN 'NA in MSstats output'
      END`,
      issueSql: source.columns.includes('issue') ? na(ident('issue'), ['NA']) : undefined,
      adjMethod: 'BH',
      method: 'MSstats',
      naTokens: ['NA'],
      rules: [
        {
          id: 'contrast_in_registry',
          severity: 'error',
          source:
            'CLAUDE.md Science conventions: contrast labels read "numerator vs denominator" from the registry',
          sql: `SELECT DISTINCT s."Label" AS example FROM ${source.table} s WHERE s."Label" NOT IN (SELECT file_label FROM ${labels})`,
          message: (n, ex) =>
            `Label(s) not matched to a registered contrast (use options.label_map): ${ex.join(', ')}.`,
        },
      ],
      transformations: [
        {
          step: 'assign_contrast',
          detail: 'Label → registered contrast by exact label (or options.label_map)',
        },
        {
          step: 'scale',
          detail:
            'MissingPercentage / ImputationPercentage (fractions 0–1) × 100 → missing_pct / imputed_pct',
        },
        ...(factor
          ? [
              {
                step: 'log_base',
                detail: `log2FC was log base ${base === Math.E ? 'e' : base}: multiplied by log2(${base === Math.E ? 'e' : base})`,
              },
            ]
          : []),
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};
