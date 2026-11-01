import { ImportError } from '../errors.ts';
import { ident, na } from '../sql.ts';
import { hasAll } from '../shared/long.ts';
import { buildDifferential, featureTypeOf, numericOf } from '../shared/differential.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// MSstats groupComparison ComparisonResult (SOURCE.md; man/groupComparison.Rd 4.21.1).
const REQUIRED = ['Protein', 'Label', 'pvalue', 'adj.pvalue'];
/** The fold-change column is named after its log base (log2FC or log10FC; groupComparison log_base). */
const fcColumn = (columns: string[]) => columns.find((c) => c === 'log2FC' || c === 'log10FC');
const ISSUE = na('s."issue"', ['NA']);

export const msstatsComparison: Importer = {
  key: 'msstats_comparison',
  label: 'MSstats groupComparison result',
  kind: 'differential_abundance',
  tool: 'MSstats',
  version: '1.0.0',
  formats: ['csv', 'tsv', 'text'],
  detect: (c) => hasAll(c, ...REQUIRED) && !!fcColumn(c),
  build(source, ctx, prefix) {
    const fc = fcColumn(source.columns);
    if (!hasAll(source.columns, ...REQUIRED) || !fc) {
      throw new ImportError(
        'wrong_format',
        `Not MSstats output: expected log2FC or log10FC and ${REQUIRED.join(', ')}.`,
      );
    }
    const base = fc === 'log10FC' ? 10 : 2;
    if (ctx.options?.log_base !== undefined && Number(ctx.options.log_base) !== base) {
      throw new ImportError(
        'bad_option',
        `log_base ${String(ctx.options.log_base)} contradicts the ${fc} column.`,
      );
    }
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
    const value = numericOf(source, ['NA']);
    const label = `(SELECT l.label FROM ${labels} l WHERE l.file_label = s."Label")`;
    // No test is possible when a condition (or everything) is missing; a p reported for such rows is not a result.
    const noTest = source.columns.includes('issue')
      ? `${ISSUE} IN ('oneConditionMissing', 'completeMissing')`
      : 'false';
    return buildDifferential(source, ctx, {
      featureColumn: 'Protein',
      featureType: featureTypeOf(ctx),
      numeric: {
        log2_fc: fc,
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
        p_value: `(CASE WHEN ${noTest} THEN NULL ELSE {v} END)`,
        adj_p_value: `(CASE WHEN ${noTest} THEN NULL ELSE {v} END)`,
        ...(base === 10 ? { log2_fc: `({v} * ${Math.log2(10)})` } : {}),
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
        WHEN ${source.columns.includes('issue') ? `${ISSUE} = 'oneConditionMissing'` : 'false'} THEN 'MSstats: one condition missing'
        WHEN ${source.columns.includes('issue') ? `${ISSUE} = 'completeMissing'` : 'false'} THEN 'MSstats: all measurements missing'
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
        {
          id: 'missing_pct_range',
          severity: 'warn',
          source: 'MSstats man/groupComparison.Rd: MissingPercentage is a fraction between 0 and 1',
          sql: `SELECT s."Protein" AS example FROM ${source.table} s WHERE ${value('MissingPercentage')} > 1 OR ${value('ImputationPercentage')} > 1`,
          message: (n, ex) =>
            `${n} row(s) have Missing/ImputationPercentage above 1 (already percent?): ${ex.join(', ')}.`,
        },
      ],
      transformations: [
        {
          step: 'assign_contrast',
          detail:
            'Label → registered contrast by exact label (or options.label_map); orientation is asserted by the registry, not the file',
        },
        {
          step: 'scale',
          detail:
            'MissingPercentage / ImputationPercentage (fractions 0–1) × 100 → missing_pct / imputed_pct',
        },
        {
          step: 'no_test',
          detail:
            'p and adjusted p are null for issue oneConditionMissing / completeMissing (no test possible)',
        },
        ...(base === 10 ? [{ step: 'log_base', detail: 'log10FC × log2(10) → log2_fc' }] : []),
      ],
      toolVersion: toolVersion(ctx),
    });
  },
};
