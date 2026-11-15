import { col, enumRule, nonNegativeRule, opt, probabilityRule, pValueRule, uniqueRule } from './types.ts';
import type { DatasetContract } from './types.ts';

const evId = col('experiment_version_id', 'uuid');
const proteinCols = [
  col('protein_group', 'text', { description: 'Protein group exactly as reported' }),
  col('protein_ids', 'text[]', { description: 'protein_group split on ";"' }),
  col('gene_names', 'text[]'),
];

export const proteinQuant: DatasetContract = {
  kind: 'protein_quant',
  version: '1.0.0',
  category: 'experiment',
  description: 'Protein-group quantities in long format (wide matrices are melted on import).',
  columns: [
    evId,
    col('sample_key', 'text'),
    col('instrument_run', 'text'),
    ...proteinCols,
    opt('intensity', 'double', { description: 'Linear scale' }),
    opt('log2_intensity', 'double'),
    opt('q_value', 'double'),
    opt('n_precursors', 'integer'),
    col('is_imputed', 'boolean'),
    opt('normalisation', 'text'),
  ],
  joinKeys: ['experiment_version_id', 'sample_key', 'protein_ids', 'gene_names'],
  qualityRules: [
    nonNegativeRule('intensity', 'Intensities are linear-scale abundances (SPEC §6.2)'),
    probabilityRule('q_value'),
    uniqueRule('one_row_per_sample_protein', [
      'experiment_version_id',
      'sample_key',
      'instrument_run',
      'protein_group',
    ]),
  ],
};

export const precursorQuant: DatasetContract = {
  kind: 'precursor_quant',
  version: '1.0.0',
  category: 'experiment',
  description: 'DIA precursor-level quantities, for QC and re-quantification.',
  columns: [
    evId,
    col('sample_key', 'text'),
    col('instrument_run', 'text'),
    col('precursor_id', 'text'),
    col('modified_sequence', 'text'),
    col('charge', 'integer'),
    ...proteinCols,
    opt('intensity', 'double'),
    opt('q_value', 'double'),
    opt('pg_q_value', 'double'),
    opt('global_q_value', 'double'),
    opt('retention_time', 'double', { unit: 'min' }),
    opt('ion_mobility', 'double'),
  ],
  joinKeys: ['experiment_version_id', 'sample_key', 'protein_ids', 'gene_names'],
  qualityRules: [
    nonNegativeRule('intensity', 'Intensities are linear-scale abundances (SPEC §6.2)'),
    probabilityRule('q_value'),
    probabilityRule('pg_q_value'),
    probabilityRule('global_q_value'),
  ],
};

export const differentialAbundance: DatasetContract = {
  kind: 'differential_abundance',
  version: '1.0.0',
  category: 'experiment',
  description: 'One row per contrast × feature. log2_fc = log2(numerator / denominator).',
  columns: [
    evId,
    col('contrast_id', 'uuid'),
    col('contrast_label', 'text', { description: '"numerator vs denominator"' }),
    col('feature_type', 'text'),
    col('feature_id', 'text'),
    col('protein_ids', 'text[]'),
    col('gene_names', 'text[]'),
    opt('log2_fc', 'double', { description: 'log2(numerator / denominator)' }),
    opt('ci_low', 'double'),
    opt('ci_high', 'double'),
    opt('se', 'double'),
    opt('t_stat', 'double'),
    opt('p_value', 'double'),
    opt('adj_p_value', 'double'),
    col('adj_method', 'text', { description: 'Benjamini–Hochberg unless the source tool says otherwise' }),
    opt('avg_log2_abundance', 'double'),
    opt('n_obs_num', 'integer'),
    opt('n_obs_den', 'integer'),
    opt('missing_pct', 'double'),
    opt('imputed_pct', 'double'),
    opt('missingness_class', 'text'),
    opt('na_reason', 'text', { description: 'Why a statistic is null' }),
    opt('issue', 'text'),
    col('method', 'text'),
    col('method_version', 'text'),
    col('source_columns', 'json', { description: 'Original column names from the tool output' }),
  ],
  joinKeys: ['experiment_version_id', 'contrast_id', 'protein_ids', 'gene_names'],
  qualityRules: [
    pValueRule('p_value'),
    pValueRule('adj_p_value'),
    enumRule('feature_type', ['protein_group', 'gene']),
    enumRule('missingness_class', ['complete', 'MAR', 'MNAR', 'partial', 'unknown']),
    enumRule('method', ['limma', 'MSstats', 'DEqMS', 'DESeq2', 'other']),
    uniqueRule('one_row_per_contrast_feature', [
      'experiment_version_id',
      'contrast_id',
      'feature_type',
      'feature_id',
    ]),
  ],
};

export const doseResponse: DatasetContract = {
  kind: 'dose_response',
  version: '1.0.0',
  category: 'experiment',
  description:
    'Fitted dose-response curves per feature × compound. Doses in molar; pEC50 = −log10(EC50 in M).',
  columns: [
    evId,
    col('feature_id', 'text'),
    col('protein_ids', 'text[]'),
    col('gene_names', 'text[]'),
    col('compound_id', 'text'),
    col('n_doses', 'integer'),
    col('doses_molar', 'double[]', { unit: 'M' }),
    col('responses', 'double[]'),
    opt('pec50', 'double', { description: '−log10(EC50 in M)' }),
    opt('ec50_molar', 'double', { unit: 'M' }),
    opt('hill_slope', 'double'),
    opt('top', 'double'),
    opt('bottom', 'double'),
    opt('curve_fold_change', 'double'),
    opt('r2', 'double'),
    opt('curve_p_value', 'double'),
    opt('relevance_score', 'double'),
    col('regulation', 'text'),
    opt('fdr', 'double'),
    col('method', 'text'),
    col('method_version', 'text'),
  ],
  joinKeys: ['experiment_version_id', 'compound_id', 'protein_ids', 'gene_names'],
  qualityRules: [
    pValueRule('curve_p_value'),
    probabilityRule('fdr'),
    nonNegativeRule('ec50_molar', 'Concentrations are non-negative'),
    enumRule('regulation', ['up', 'down', 'not', 'unclear']),
    enumRule('method', ['CurveCurator', 'MSstatsResponse', '4PL']),
  ],
};

// Thermal proteome profiling, temperature range (Phase 46). Definitions: packages/importers/src/tpp_tr/SOURCE.md
// (Bioconductor TPP 3.40.2). Temperatures in °C, as the tool's config table gives them.
const DEG = { unit: '°C' };
export const thermalShift: DatasetContract = {
  kind: 'thermal_shift',
  version: '1.0.0',
  category: 'experiment',
  description:
    'Thermal shifts per feature × comparison (treatment vs vehicle): melting points, ΔTm and the fold changes by temperature.',
  columns: [
    evId,
    col('feature_id', 'text'),
    col('protein_ids', 'text[]'),
    col('gene_names', 'text[]'),
    col('compound_id', 'text'),
    col('comparison', 'text', { description: '"treatment experiment vs vehicle experiment"' }),
    col('treatment_experiment', 'text'),
    col('vehicle_experiment', 'text'),
    col('temperatures_c', 'double[]', {
      ...DEG,
      description: 'Ascending; the fold changes follow this order',
    }),
    col('fc_treatment', 'double[]', { description: 'Fold change relative to the lowest temperature' }),
    col('fc_vehicle', 'double[]', { description: 'Fold change relative to the lowest temperature' }),
    col('fold_change_normalised', 'boolean', { description: 'The tool normalised the fold changes' }),
    opt('melt_point_treatment', 'double', {
      ...DEG,
      description: 'Temperature where the fitted curve is 0.5',
    }),
    opt('melt_point_vehicle', 'double', { ...DEG, description: 'Temperature where the fitted curve is 0.5' }),
    opt('delta_tm', 'double', {
      ...DEG,
      description: 'Melting point, treatment − vehicle (positive: stabilised)',
    }),
    opt('min_slope', 'double', { description: 'The smaller of the two slopes at the inflection points' }),
    opt('slope_treatment', 'double'),
    opt('slope_vehicle', 'double'),
    opt('plateau_treatment', 'double'),
    opt('plateau_vehicle', 'double'),
    opt('r2_treatment', 'double'),
    opt('r2_vehicle', 'double'),
    opt('a_treatment', 'double', {
      description: 'Fitted parameter a of y = (1 − Pl) / (1 + exp(−(a/T − b))) + Pl',
    }),
    opt('b_treatment', 'double'),
    opt('a_vehicle', 'double'),
    opt('b_vehicle', 'double'),
    opt('adj_p_value', 'double', {
      description: 'Adjusted p of the melting-point difference; null if not tested',
    }),
    col('adj_method', 'text'),
    opt('passed_filter', 'boolean', { description: 'The comparison passed the tool’s curve-quality filter' }),
    opt('fulfills_all_requirements', 'boolean', {
      description: 'The protein met all of the tool’s replicate checks (the same on each of its rows)',
    }),
    col('method', 'text'),
    col('method_version', 'text'),
  ],
  joinKeys: ['experiment_version_id', 'compound_id', 'protein_ids', 'gene_names'],
  qualityRules: [
    uniqueRule('one_row_per_feature_comparison', ['experiment_version_id', 'comparison', 'feature_id']),
    pValueRule('adj_p_value'),
    enumRule('method', ['TPP']),
  ],
};

export const qcMetrics: DatasetContract = {
  kind: 'qc_metrics',
  version: '1.1.0',
  category: 'experiment',
  description: 'QC metrics per run, sample or experiment.',
  columns: [
    evId,
    col('scope', 'text'),
    col('scope_key', 'text'),
    col('metric', 'text'),
    opt('value', 'double'),
    opt('unit', 'text'),
    opt('threshold', 'double'),
    col('status', 'text', {
      description: 'pass | warn | fail against threshold; not_assessed when no threshold',
    }),
  ],
  joinKeys: ['experiment_version_id'],
  qualityRules: [
    enumRule('scope', ['run', 'sample', 'experiment']),
    // not_assessed (1.1.0): tools such as mzQC report metrics without thresholds (ADR 0018).
    enumRule('status', ['pass', 'warn', 'fail', 'not_assessed']),
  ],
};

export const rnaseqCounts: DatasetContract = {
  kind: 'rnaseq_counts',
  version: '1.0.0',
  category: 'experiment',
  description: 'Gene-level RNA-seq counts.',
  columns: [
    evId,
    col('sample_key', 'text'),
    col('gene_id', 'text', { description: 'Ensembl gene ID' }),
    col('gene_name', 'text'),
    col('count', 'double'),
    opt('tpm', 'double'),
  ],
  joinKeys: ['experiment_version_id', 'sample_key'],
  qualityRules: [
    nonNegativeRule('count', 'Read counts are non-negative'),
    nonNegativeRule('tpm', 'TPM is non-negative'),
  ],
};

export const crisprGeneSummary: DatasetContract = {
  kind: 'crispr_gene_summary',
  version: '1.0.0',
  category: 'experiment',
  description: 'Gene-level CRISPR screen summary (MAGeCK pipe-delimited headers reshaped).',
  columns: [
    evId,
    col('gene', 'text'),
    col('n_guides', 'integer'),
    ...['neg', 'pos'].flatMap((side) => [
      opt(`${side}_score`, 'double'),
      opt(`${side}_p`, 'double'),
      opt(`${side}_fdr`, 'double'),
      opt(`${side}_rank`, 'integer'),
      opt(`${side}_lfc`, 'double'),
    ]),
  ],
  joinKeys: ['experiment_version_id'],
  qualityRules: [
    pValueRule('neg_p'),
    pValueRule('pos_p'),
    probabilityRule('neg_fdr'),
    probabilityRule('pos_fdr'),
  ],
};
