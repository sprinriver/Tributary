import { ImportError } from '../errors.ts';
import { ident, na, num, split } from '../sql.ts';
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
  if (Object.values(t).some((v) => v !== null && typeof v === 'object'))
    throw new ImportError(
      'needs_temperatures',
      'options.temperatures takes one map for all experiments (label → °C), not one map per experiment.',
    );
  const map = new Map(Object.entries(t).map(([label, value]) => [label, Number(value)]));
  for (const [label, value] of map) {
    if (!Number.isFinite(value))
      throw new ImportError(
        'needs_temperatures',
        `options.temperatures: "${label}" has no numeric temperature.`,
      );
    // The stored curve parameters are only valid in the unit the tool fitted in (°C, SOURCE.md).
    if (value < 0 || value > 100)
      throw new ImportError(
        'temperatures_mismatch',
        `options.temperatures: "${label}" = ${value} is not a temperature in °C (0–100).`,
      );
  }
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
    // TPP's Protein_ID is whatever idVar the user chose (by default gene_name): never guessed.
    const featureType = o.feature_type;
    if (featureType !== 'gene' && featureType !== 'protein_group')
      throw new ImportError(
        'needs_feature_type',
        'tpp_tr needs options.feature_type: "gene" when Protein_ID holds gene symbols (TPP’s default idVar is gene_name), "protein_group" when it holds accessions.',
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
    // The example table names the filter column vehicle-first (SOURCE.md); either order is read.
    const filterOf = (t: string, v: string) =>
      [`passed_filter_${v}_vs_${t}`, `passed_filter_${t}_vs_${v}`].find(has);
    const noFilter = comparisons.filter((c) => !filterOf(c.t, c.v));
    const nonFinite = (columns: string[]) =>
      columns
        .filter(has)
        .map((c) => `(CASE WHEN trim(${ident(c)}) IN ('Inf', '-Inf', 'NaN') THEN 1 ELSE 0 END)`)
        .join(' + ') || '0';
    const vehicleOnly = source.columns.filter(
      (c) => c.startsWith('diff_meltP_') && !comparisons.some((x) => c === `diff_meltP_${x.name}`),
    );
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
      const read = [
        ...[t, v].flatMap((e) => [
          ...labels.map((l) => `${fcPrefix}${l}_${e}`),
          ...Object.values(PER_EXPERIMENT).map((c) => `${c}_${e}`),
        ]),
        `diff_meltP_${name}`,
        `min_slope_${name}`,
        `pVal_adj_${name}`,
      ];
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
          ${flag(filterOf(t, v))} AS passed_filter,
          ${flag(source.columns.find((c) => /^fulfills_all_\d+_requirements$/.test(c)))} AS fulfills_all_requirements,
          'TPP' AS method,
          $method_version AS method_version,
          (${nonFinite(read)})::INTEGER AS __non_finite
        FROM ${source.table}`;
    });
    return {
      setup: [],
      select: selects.join('\n        UNION ALL'),
      params,
      rules: [
        {
          id: 'non_finite_values',
          severity: 'warn',
          source: 'CLAUDE.md science conventions: NA meanings are mapped explicitly, never silently',
          sql: `SELECT feature_id AS example FROM {work} WHERE __non_finite > 0`,
          message: (n, ex) =>
            `${n} row(s) have Inf or NaN values (a degenerate fit), read as null${ex.length ? `: ${ex.join(', ')}` : ''}.`,
        },
        ...(noFilter.length
          ? [
              {
                id: 'no_filter_column',
                severity: 'warn' as const,
                source: 'packages/importers/src/tpp_tr/SOURCE.md (passed_filter_<V>_vs_<T>)',
                sql: `SELECT feature_id AS example FROM {canon} LIMIT 1`,
                message: () =>
                  `The table has no passed_filter column for ${noFilter.map((c) => `${c.t} vs ${c.v}`).join('; ')}: passed_filter is empty.`,
              },
            ]
          : []),
      ],
      transformations: [
        {
          step: 'reshape',
          detail: `One row per protein and comparison: ${comparisons.map((c) => `${c.t} vs ${c.v}`).join('; ')}. Not imported: ${vehicleOnly.length ? `the vehicle-vs-vehicle differences (${vehicleOnly.join(', ')}), ` : ''}inflPoint_*, model_converged_*, sufficient_data_for_fit_*, protein_identified_in_*, qssm_*, qupm_* and the four single replicate checks (only fulfills_all_requirements is kept).`,
        },
        {
          step: 'temperatures',
          detail: `temperatures_c from options.temperatures (${labels.map((l) => `${l} = ${temperatures.get(l)} °C`).join(', ')}), the same temperatures for every experiment; fold changes (${fcPrefix}*, ${normalised ? 'normalised by the tool' : 'not normalised'}) in ascending temperature`,
        },
        {
          step: 'adjusted_p',
          detail: `adj_p_value = pVal_adj_<treatment>_vs_<vehicle>: ${ADJ_METHOD}; NA (comparison failed the tool's curve filter, or no fit) stays null. The tool writes no unadjusted p-value.`,
        },
        {
          step: 'rename',
          detail: 'delta_tm = diff_meltP (melting point, treatment − vehicle), as the tool computed it',
        },
        {
          step: 'feature',
          detail: `Protein_ID read as ${featureType === 'gene' ? 'gene symbols → gene_names' : 'protein accessions → protein_ids'} (options.feature_type = ${featureType})`,
        },
        {
          step: 'filter',
          detail: `passed_filter from ${comparisons.map((c) => filterOf(c.t, c.v) ?? `no column for ${c.t} vs ${c.v} (empty)`).join(', ')}`,
        },
      ],
      naTokens: NA_TOKENS,
      toolVersion: toolVersion(ctx),
      mapping: {
        feature_id: 'Protein_ID',
        delta_tm: 'diff_meltP_<T>_vs_<V>',
        adj_p_value: 'pVal_adj_<T>_vs_<V>',
        min_slope: 'min_slope_<T>_vs_<V>',
        passed_filter: comparisons.map((c) => filterOf(c.t, c.v) ?? 'absent').join(', '),
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
