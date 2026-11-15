import { ImportError } from '../errors.ts';
import { ident, na, num, split } from '../sql.ts';
import { featureTypeOf } from '../shared/differential.ts';
import { toolVersion } from '../shared/wide.ts';
import type { Importer } from '../types.ts';

// TPP-TR result table (SOURCE.md: Bioconductor TPP 3.40.2, analyzeTPPTR / tpptrAnalyzeMeltingCurves output).
// One wide row per protein → one row per protein and treatment-vs-vehicle comparison. Nothing is computed:
// melting points, ΔTm (diff_meltP = treatment − vehicle) and adjusted p-values are the tool's own values.
const NA_TOKENS = ['NA', 'NaN', 'Inf', '-Inf'];
const ADJ_METHOD = 'BH (TPP robust z-test within slope bins)';
// canonical prefix → the tool's per-experiment column prefix
const PER_EXPERIMENT: Record<string, string> = {
  melt_point: 'meltPoint',
  slope: 'slope',
  plateau: 'plateau',
  r2: 'R_sq',
  a: 'a',
  b: 'b',
};

function temperaturesOf(options: Record<string, unknown>): Map<string, number> {
  const t = options.temperatures;
  if (!t || typeof t !== 'object' || Array.isArray(t) || Object.keys(t).length === 0)
    throw new ImportError(
      'needs_temperatures',
      'tpp_tr needs options.temperatures: the temperature in °C of each label, e.g. {"126": 37, "127L": 41} (the TPP config table).',
    );
  const map = new Map(Object.entries(t).map(([label, value]) => [label, Number(value)]));
  for (const [label, value] of map)
    if (!Number.isFinite(value))
      throw new ImportError(
        'needs_temperatures',
        `options.temperatures: "${label}" has no numeric temperature.`,
      );
  if (new Set(map.values()).size !== map.size)
    throw new ImportError(
      'temperatures_mismatch',
      'options.temperatures: two labels have the same temperature.',
    );
  return map;
}

export const tppTr: Importer = {
  key: 'tpp_tr',
  label: 'TPP-TR result table (thermal proteome profiling)',
  kind: 'thermal_shift',
  tool: 'TPP',
  version: '1.0.0',
  formats: ['tsv', 'text'],
  detect: (c) =>
    c.includes('Protein_ID') &&
    c.some((x) => x.startsWith('meltPoint_')) &&
    c.some((x) => x.startsWith('diff_meltP_')) &&
    c.some((x) => /^(norm_)?rel_fc_/.test(x)),
  build(source, ctx) {
    const o = ctx.options ?? {};
    const temperatures = temperaturesOf(o);
    if (typeof o.compound_id !== 'string' || !o.compound_id)
      throw new ImportError(
        'needs_compound',
        'tpp_tr needs options.compound_id (the compound of the treatment).',
      );
    const has = (c: string) => source.columns.includes(c);
    const experiments = source.columns.filter((c) => c.startsWith('meltPoint_')).map((c) => c.slice(10));
    // A treatment comparison has an adjusted p-value column; the vehicle-vs-vehicle difference has none.
    const comparisons = source.columns
      .filter((c) => c.startsWith('pVal_adj_'))
      .map((c) => {
        const name = c.slice(9);
        for (const t of experiments)
          for (const v of experiments) if (name === `${t}_vs_${v}`) return { name, t, v };
        throw new ImportError(
          'unknown_comparison',
          `Column ${c} does not name two experiments of this table.`,
        );
      });
    if (comparisons.length === 0)
      throw new ImportError('no_comparison', 'The table has no pVal_adj_<treatment>_vs_<vehicle> column.');
    const normalised = source.columns.some((c) => c.startsWith('norm_rel_fc_'));
    const fcPrefix = normalised ? 'norm_rel_fc_' : 'rel_fc_';
    const labels = [...temperatures.keys()].sort((x, y) => temperatures.get(x)! - temperatures.get(y)!);
    for (const e of new Set(comparisons.flatMap((c) => [c.t, c.v]))) {
      const inFile = source.columns
        .filter((c) => c.startsWith(fcPrefix) && c.endsWith(`_${e}`))
        .map((c) => c.slice(fcPrefix.length, -e.length - 1));
      const missing = inFile.filter((l) => !temperatures.has(l));
      if (missing.length > 0)
        throw new ImportError(
          'temperatures_mismatch',
          `options.temperatures has no temperature for label ${missing.join(', ')} (experiment ${e}).`,
        );
      const absent = labels.filter((l) => !inFile.includes(l));
      if (absent.length > 0)
        throw new ImportError(
          'temperatures_mismatch',
          `options.temperatures names label ${absent.join(', ')}, which experiment ${e} does not have.`,
        );
    }
    const value = (column: string) =>
      has(column) ? num(na(ident(column), NA_TOKENS), source.decimal) : 'NULL::DOUBLE';
    const flag = (column: string | undefined) =>
      column && has(column) ? `TRY_CAST(${na(ident(column), NA_TOKENS)} AS BOOLEAN)` : 'NULL::BOOLEAN';
    const fcs = (e: string) => `[${labels.map((l) => value(`${fcPrefix}${l}_${e}`)).join(', ')}]`;
    const featureType = featureTypeOf(ctx);
    const params: Record<string, string | number | boolean | null> = {
      ev: ctx.experimentVersionId ?? null,
      compound_id: o.compound_id,
      temps: JSON.stringify(labels.map((l) => temperatures.get(l)!)),
      normalised,
      method_version: toolVersion(ctx),
    };
    const selects = comparisons.map(({ name, t, v }, i) => {
      params[`t${i}`] = t;
      params[`v${i}`] = v;
      params[`c${i}`] = `${t} vs ${v}`;
      const perExperiment = Object.entries(PER_EXPERIMENT).flatMap(([canonical, original]) => [
        `${value(`${original}_${t}`)} AS ${canonical}_treatment`,
        `${value(`${original}_${v}`)} AS ${canonical}_vehicle`,
      ]);
      return `
        SELECT
          $ev::UUID AS experiment_version_id,
          "Protein_ID" AS feature_id,
          ${featureType === 'protein_group' ? split('"Protein_ID"') : '[]::VARCHAR[]'} AS protein_ids,
          ${featureType === 'gene' ? split('"Protein_ID"') : '[]::VARCHAR[]'} AS gene_names,
          $compound_id AS compound_id,
          $c${i} AS comparison,
          $t${i} AS treatment_experiment,
          $v${i} AS vehicle_experiment,
          $temps::JSON::DOUBLE[] AS temperatures_c,
          ${fcs(t)} AS fc_treatment,
          ${fcs(v)} AS fc_vehicle,
          $normalised::BOOLEAN AS fold_change_normalised,
          ${perExperiment.join(',\n          ')},
          ${value(`diff_meltP_${name}`)} AS delta_tm,
          ${value(`min_slope_${name}`)} AS min_slope,
          ${value(`pVal_adj_${name}`)} AS adj_p_value,
          '${ADJ_METHOD}' AS adj_method,
          ${flag(`passed_filter_${v}_vs_${t}`)} AS passed_filter,
          ${flag(source.columns.find((c) => /^fulfills_all_\d+_requirements$/.test(c)))} AS fulfills_all_requirements,
          'TPP' AS method,
          $method_version AS method_version
        FROM ${source.table}`;
    });
    return {
      setup: [],
      select: selects.join('\n        UNION ALL'),
      params,
      rules: [],
      transformations: [
        {
          step: 'reshape',
          detail: `One row per protein and comparison: ${comparisons.map((c) => `${c.t} vs ${c.v}`).join('; ')}. Vehicle-vs-vehicle differences and the single replicate checks are not imported.`,
        },
        {
          step: 'temperatures',
          detail: `temperatures_c from options.temperatures (${labels.map((l) => `${l} = ${temperatures.get(l)} °C`).join(', ')}); fold changes (${fcPrefix}*, ${normalised ? 'normalised by the tool' : 'not normalised'}) in ascending temperature`,
        },
        {
          step: 'adjusted_p',
          detail: `adj_p_value = pVal_adj_<treatment>_vs_<vehicle>: ${ADJ_METHOD}; NA (comparison failed the tool's curve filter, or no fit) stays null. The tool writes no unadjusted p-value.`,
        },
        {
          step: 'rename',
          detail: 'delta_tm = diff_meltP (melting point, treatment − vehicle), as the tool computed it',
        },
        ...(featureType === 'gene'
          ? [{ step: 'feature', detail: 'Protein_ID read as gene symbols (options.feature_type = gene)' }]
          : []),
      ],
      naTokens: NA_TOKENS,
      toolVersion: toolVersion(ctx),
      mapping: {
        feature_id: 'Protein_ID',
        delta_tm: 'diff_meltP_<T>_vs_<V>',
        adj_p_value: 'pVal_adj_<T>_vs_<V>',
        min_slope: 'min_slope_<T>_vs_<V>',
        passed_filter: 'passed_filter_<V>_vs_<T>',
        fc_treatment: `${fcPrefix}<label>_<T>`,
        fc_vehicle: `${fcPrefix}<label>_<V>`,
        ...Object.fromEntries(
          Object.entries(PER_EXPERIMENT).flatMap(([c, orig]) => [
            [`${c}_treatment`, `${orig}_<T>`],
            [`${c}_vehicle`, `${orig}_<V>`],
          ]),
        ),
      },
    };
  },
};
