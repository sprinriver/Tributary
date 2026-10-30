import { ImportError } from '../errors.ts';
import { ident, na, num, split } from '../sql.ts';
import type { BuiltImport, ImportContext, SourceTable } from '../types.ts';
import { GENE_COLUMNS, idColumn } from './detect.ts';
import { NUMERIC_MAP } from './map.ts';
import { ACCESSION_RULE, CI_RULE } from './rules.ts';

// R write.table writes missing values as "NA".
const NA_TOKENS = ['NA'];

export function buildTopTable(source: SourceTable, ctx: ImportContext): BuiltImport {
  if (!ctx.contrast)
    throw new ImportError('needs_contrast', 'limma_toptable needs the contrast this table belongs to.');
  if (source.columns.includes('F')) {
    throw new ImportError(
      'multiple_contrasts',
      'This topTable tests several coefficients (F column); import one contrast per file.',
    );
  }
  const options = ctx.options ?? {};
  const idName = idColumn(source.columns);
  if (!idName) {
    throw new ImportError(
      'no_identifier',
      'The topTable has no identifier column (ID or row names). Write it with row.names = TRUE, col.names = NA.',
    );
  }
  const explicitType = options.feature_type === 'gene' || options.feature_type === 'protein_group';
  const featureType = options.feature_type === 'gene' ? 'gene' : 'protein_group';
  const id = ident(idName);
  const geneColumn = GENE_COLUMNS.find((c) => source.columns.includes(c));
  const mapping: Record<string, string> = { feature_id: idName };
  if (geneColumn) mapping.gene_names = geneColumn;
  const numeric = Object.entries(NUMERIC_MAP).flatMap(([canonical, original]) => {
    if (!source.columns.includes(original)) return [`NULL::DOUBLE AS ${canonical}`];
    mapping[canonical] = original;
    const raw = na(ident(original), NA_TOKENS);
    return [`${num(raw, source.decimal)} AS ${canonical}`, `${raw} AS __raw_${canonical}`];
  });
  const pValue = source.columns.includes('P.Value')
    ? num(na(ident('P.Value'), NA_TOKENS), source.decimal)
    : 'NULL';
  return {
    setup: [],
    select: `
      SELECT
        $ev::UUID AS experiment_version_id,
        $contrast_id::UUID AS contrast_id,
        $contrast_label AS contrast_label,
        $feature_type AS feature_type,
        ${id} AS feature_id,
        CASE WHEN $feature_type = 'protein_group' THEN ${split(id)} ELSE []::VARCHAR[] END AS protein_ids,
        ${geneColumn ? split(ident(geneColumn)) : '[]::VARCHAR[]'} AS gene_names,
        ${numeric.join(',\n        ')},
        NULL::DOUBLE AS se,
        $adj_method AS adj_method,
        NULL::INTEGER AS n_obs_num,
        NULL::INTEGER AS n_obs_den,
        NULL::DOUBLE AS missing_pct,
        NULL::DOUBLE AS imputed_pct,
        NULL::VARCHAR AS missingness_class,
        CASE WHEN ${pValue} IS NULL THEN 'NA in topTable output' END AS na_reason,
        NULL::VARCHAR AS issue,
        'limma' AS method,
        $method_version AS method_version,
        $source_columns::JSON AS source_columns
      FROM ${source.table}`,
    params: {
      ev: ctx.experimentVersionId ?? null,
      contrast_id: ctx.contrast.id,
      contrast_label: ctx.contrast.label,
      feature_type: featureType,
      // topTable's default adjust.method is "BH" (limma man/toptable.Rd); callers state otherwise explicitly.
      adj_method: typeof options.adj_method === 'string' ? options.adj_method : 'BH',
      method_version: typeof options.tool_version === 'string' ? options.tool_version : 'unknown',
      source_columns: JSON.stringify(mapping),
    },
    rules: [CI_RULE, ...(featureType === 'protein_group' ? [ACCESSION_RULE] : [])],
    transformations: [
      { step: 'rename', detail: 'topTable columns → differential_abundance (see source.mapping)' },
      ...(explicitType
        ? []
        : [
            {
              step: 'default',
              detail:
                'feature_type = protein_group (not given; IDs checked against the UniProt accession format)',
            },
          ]),
      {
        step: 'split',
        detail: `protein_ids = ${idName} split on ";"${geneColumn ? `; gene_names = ${geneColumn} split on ";"` : ''}`,
      },
      { step: 'assign_contrast', detail: `All rows belong to contrast "${ctx.contrast.label}"` },
    ],
    naTokens: NA_TOKENS,
    toolVersion: typeof options.tool_version === 'string' ? options.tool_version : 'unknown',
    mapping,
  };
}
