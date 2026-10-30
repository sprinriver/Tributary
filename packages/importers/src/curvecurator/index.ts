import { ImportError } from '../errors.ts';
import { ident, na, num, split } from '../sql.ts';
import { featureTypeOf } from '../shared/differential.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// CurveCurator curves file (SOURCE.md; curve_curator 0.6.0 quantification.py / thresholding.py, README TOML).
const NUMERIC: Record<string, string> = {
  pec50: 'pEC50',
  hill_slope: 'Curve Slope',
  top: 'Curve Front',
  bottom: 'Curve Back',
  curve_fold_change: 'Curve Fold Change',
  r2: 'Curve R2',
  curve_p_value: 'Curve P_Value',
  relevance_score: 'Curve Relevance Score',
  fdr: 'Curve q_Value',
};
const NA_TOKENS = ['NA', 'nan', 'NaN'];

export const curvecurator: Importer = {
  key: 'curvecurator',
  label: 'CurveCurator curves file',
  kind: 'dose_response',
  tool: 'CurveCurator',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: (c) =>
    c.includes('pEC50') && c.includes('Curve Regulation') && c.some((x) => /^Ratio \d+$/.test(x)),
  build(source, ctx) {
    const o = ctx.options ?? {};
    const doses = Array.isArray(o.doses) ? o.doses.map(Number) : null;
    if (!doses || doses.some((d) => !Number.isFinite(d) || d < 0)) {
      throw new ImportError(
        'needs_doses',
        'curvecurator needs options.doses (the TOML doses, control = 0) and dose_scale.',
      );
    }
    const scale = Number(o.dose_scale ?? NaN);
    if (!Number.isFinite(scale) || scale <= 0)
      throw new ImportError('needs_doses', 'curvecurator needs options.dose_scale (e.g. 1e-9 for nM doses).');
    if (o.dose_unit !== 'M')
      throw new ImportError(
        'not_molar',
        'dose_unit must be "M": doses are stored in molar and pEC50 = −log10(EC50 in M).',
      );
    if (typeof o.compound_id !== 'string' || !o.compound_id)
      throw new ImportError('needs_compound', 'curvecurator needs options.compound_id.');
    const ratios = source.columns
      .filter((c) => /^Ratio \d+$/.test(c))
      .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
    if (ratios.length !== doses.length) {
      throw new ImportError(
        'doses_mismatch',
        `The file has ${ratios.length} Ratio columns but ${doses.length} doses were given.`,
      );
    }
    // 12 significant digits: removes binary noise from d × scale (e.g. 100 × 1e-9 → 1e-7, not 1.0000000000000001e-7).
    const molar = doses.map((d) => Number((d * scale).toPrecision(12)));
    const nDoses = new Set(molar.filter((d) => d > 0)).size;
    const value = (column: string) =>
      source.columns.includes(column) ? num(na(ident(column), NA_TOKENS), source.decimal) : 'NULL::DOUBLE';
    const featureType = featureTypeOf(ctx);
    const numeric = Object.entries(NUMERIC).flatMap(([canonical, original]) =>
      source.columns.includes(original)
        ? [`${value(original)} AS ${canonical}`, `${na(ident(original), NA_TOKENS)} AS __raw_${canonical}`]
        : [`NULL::DOUBLE AS ${canonical}`],
    );
    return {
      setup: [],
      select: `
        SELECT
          $ev::UUID AS experiment_version_id,
          "Name" AS feature_id,
          ${featureType === 'protein_group' ? split('"Name"') : '[]::VARCHAR[]'} AS protein_ids,
          ${source.columns.includes('Genes') ? split('"Genes"') : '[]::VARCHAR[]'} AS gene_names,
          $compound_id AS compound_id,
          $n_doses::INTEGER AS n_doses,
          $doses::JSON::DOUBLE[] AS doses_molar,
          [${ratios.map((r) => value(r)).join(', ')}] AS responses,
          ${numeric.join(',\n          ')},
          CASE WHEN ${value('pEC50')} IS NOT NULL THEN power(10, -${value('pEC50')}) END AS ec50_molar,
          coalesce(${na('"Curve Regulation"', NA_TOKENS)}, 'unclear') AS regulation,
          'CurveCurator' AS method,
          $method_version AS method_version
        FROM ${source.table}`,
      params: {
        ev: ctx.experimentVersionId ?? null,
        compound_id: o.compound_id,
        n_doses: nDoses,
        doses: JSON.stringify(molar),
        method_version: toolVersion(ctx),
      },
      rules: [
        {
          id: 'enough_doses',
          severity: 'warn',
          source: '.claude/rules/science.md: ≥ 4 dose levels for curve fits',
          sql: `SELECT feature_id AS example FROM {canon} WHERE n_doses < 4 LIMIT 1`,
          message: () => `Only ${nDoses} non-zero dose level(s); curve fits need at least 4.`,
        },
      ],
      transformations: [
        {
          step: 'doses',
          detail: `doses_molar = options.doses × dose_scale (${scale}); n_doses = ${nDoses} non-zero levels`,
        },
        { step: 'responses', detail: `responses = ${ratios.join(', ')} in order` },
        { step: 'derive', detail: 'ec50_molar = 10^−pEC50 (dose_unit M)' },
        {
          step: 'rename',
          detail: 'top = Curve Front, bottom = Curve Back (CurveCurator plateaus, not sorted by size)',
        },
        { step: 'regulation', detail: 'Empty Curve Regulation (unclassified) → "unclear"' },
      ],
      naTokens: NA_TOKENS,
      toolVersion: toolVersion(ctx),
      mapping: { feature_id: 'Name', responses: ratios.join(', '), ...NUMERIC },
    };
  },
};
