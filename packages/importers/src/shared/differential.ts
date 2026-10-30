import { ImportError } from '../errors.ts';
import { ident, na, num, split } from '../sql.ts';
import type { BuiltImport, ImportContext, ImporterRule, SourceTable, Transformation } from '../types.ts';

// differential_abundance builder shared by DEqMS, DESeq2 and MSstats: canonical column → SQL over the source rows.

export interface DifferentialSpec {
  featureColumn: string;
  featureType: 'protein_group' | 'gene';
  genesColumn?: string | undefined;
  /** canonical numeric column → source column (missing source columns become null). */
  numeric: Record<string, string>;
  /** SQL for contrast_id / contrast_label (default: the single contrast from the context, as parameters). */
  contrastSql?: { id: string; label: string };
  naReasonSql: string;
  issueSql?: string | undefined;
  adjMethod: string;
  method: string;
  /** Extra per-column transforms on the parsed value, e.g. percentage scaling. */
  scale?: Record<string, string>;
  naTokens: string[];
  rules?: ImporterRule[];
  transformations: Transformation[];
  toolVersion: string;
  setup?: BuiltImport['setup'];
}

/** `value(column)` → the parsed numeric value of a source column with the tool's NA tokens. */
export const numericOf = (source: SourceTable, naTokens: string[]) => (column: string) =>
  source.columns.includes(column) ? num(na(ident(column), naTokens), source.decimal) : 'NULL::DOUBLE';

export function buildDifferential(
  source: SourceTable,
  ctx: ImportContext,
  spec: DifferentialSpec,
): BuiltImport {
  if (!spec.contrastSql && !ctx.contrast) {
    throw new ImportError(
      'needs_contrast',
      'Choose the contrast this table belongs to (it fixes the sign of log2 fold change).',
    );
  }
  const value = numericOf(source, spec.naTokens);
  const feature = ident(spec.featureColumn);
  const mapping: Record<string, string> = { feature_id: spec.featureColumn };
  if (spec.genesColumn) mapping.gene_names = spec.genesColumn;
  const numeric = [
    'log2_fc',
    'ci_low',
    'ci_high',
    'se',
    't_stat',
    'p_value',
    'adj_p_value',
    'avg_log2_abundance',
    'missing_pct',
    'imputed_pct',
  ].flatMap((canonical) => {
    const original = spec.numeric[canonical];
    if (!original || !source.columns.includes(original)) return [`NULL::DOUBLE AS ${canonical}`];
    mapping[canonical] = original;
    const scaled = spec.scale?.[canonical]
      ? spec.scale[canonical]!.replace('{v}', value(original))
      : value(original);
    return [`${scaled} AS ${canonical}`, `${na(ident(original), spec.naTokens)} AS __raw_${canonical}`];
  });
  const genes =
    spec.genesColumn && source.columns.includes(spec.genesColumn)
      ? split(ident(spec.genesColumn))
      : '[]::VARCHAR[]';
  return {
    setup: spec.setup ?? [],
    select: `
      SELECT
        $ev::UUID AS experiment_version_id,
        ${spec.contrastSql ? spec.contrastSql.id : '$contrast_id::UUID'} AS contrast_id,
        ${spec.contrastSql ? spec.contrastSql.label : '$contrast_label'} AS contrast_label,
        $feature_type AS feature_type,
        ${feature} AS feature_id,
        ${spec.featureType === 'protein_group' ? split(feature) : '[]::VARCHAR[]'} AS protein_ids,
        ${genes} AS gene_names,
        ${numeric.join(',\n        ')},
        $adj_method AS adj_method,
        NULL::INTEGER AS n_obs_num,
        NULL::INTEGER AS n_obs_den,
        NULL::VARCHAR AS missingness_class,
        ${spec.naReasonSql} AS na_reason,
        ${spec.issueSql ?? 'NULL::VARCHAR'} AS issue,
        $method AS method,
        $method_version AS method_version,
        $source_columns::JSON AS source_columns
      FROM ${source.table} s`,
    params: {
      ev: ctx.experimentVersionId ?? null,
      ...(spec.contrastSql ? {} : { contrast_id: ctx.contrast!.id, contrast_label: ctx.contrast!.label }),
      feature_type: spec.featureType,
      adj_method: spec.adjMethod,
      method: spec.method,
      method_version: spec.toolVersion,
      source_columns: JSON.stringify(mapping),
    },
    rules: spec.rules ?? [],
    transformations: [
      { step: 'rename', detail: `${spec.method} columns → differential_abundance (see source.mapping)` },
      ...spec.transformations,
    ],
    naTokens: spec.naTokens,
    toolVersion: spec.toolVersion,
    mapping,
  };
}

/** feature_type from options; protein_group unless the caller says gene. */
export const featureTypeOf = (ctx: ImportContext, fallback: 'protein_group' | 'gene' = 'protein_group') =>
  ctx.options?.feature_type === 'gene'
    ? 'gene'
    : ctx.options?.feature_type === 'protein_group'
      ? 'protein_group'
      : fallback;
