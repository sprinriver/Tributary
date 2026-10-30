import { DATASET_CONTRACTS, DatasetKindSchema, type DatasetKind } from '@tributary/contracts';
import { z } from 'zod';
import { ImportError } from '../errors.ts';
import { ident, na, typed } from '../sql.ts';
import type { BuiltImport, ImportContext, Importer, SourceTable } from '../types.ts';

/** A saved column mapping (SPEC §6.3 custom_tabular): canonical column → source column, or a constant. */
export const TabularMappingSchema = z.object({
  kind: DatasetKindSchema,
  columns: z.record(z.string(), z.string()),
  constants: z.record(z.string(), z.string()).optional(),
  array_separator: z.string().min(1).max(3).optional(),
  na_tokens: z.array(z.string()).optional(),
});
export type TabularMapping = z.infer<typeof TabularMappingSchema>;

const DEFAULT_NA = ['NA', 'N/A', 'NaN', 'null'];

/** Columns filled from the import context, never from the file. */
function fromContext(name: string, ctx: ImportContext): string | undefined {
  if (name === 'experiment_version_id') return ctx.experimentVersionId;
  if (name === 'program_id') return ctx.programId;
  return undefined;
}

export function buildTabular(source: SourceTable, ctx: ImportContext, mapping: TabularMapping): BuiltImport {
  const contract = DATASET_CONTRACTS[mapping.kind as DatasetKind];
  if (contract.category === 'metadata') {
    throw new ImportError(
      'not_importable',
      `${mapping.kind} is a live metadata view and cannot be imported.`,
    );
  }
  const constants = mapping.constants ?? {};
  const separator = mapping.array_separator ?? ';';
  const naTokens = mapping.na_tokens ?? DEFAULT_NA;
  const params: Record<string, string | null> = {};
  const transformations: BuiltImport['transformations'] = [];
  const unknown = Object.values(mapping.columns).filter((c) => !source.columns.includes(c));
  if (unknown.length) {
    throw new ImportError(
      'unknown_column',
      `Not in the file: ${unknown.join(', ')}. Columns: ${source.columns.join(', ')}.`,
    );
  }
  const extra = Object.keys({ ...mapping.columns, ...constants }).filter(
    (c) => !contract.columns.some((col) => col.name === c),
  );
  if (extra.length)
    throw new ImportError('unknown_target', `${mapping.kind} has no column ${extra.join(', ')}.`);

  const missing: string[] = [];
  const exprs = contract.columns.flatMap((column, i) => {
    const name = ident(column.name);
    const context = fromContext(column.name, ctx);
    if (context !== undefined) {
      params[`ctx${i}`] = context;
      return [`$ctx${i}::VARCHAR AS ${name}`];
    }
    const sourceColumn = mapping.columns[column.name];
    const constant = constants[column.name];
    let raw: string | undefined;
    if (sourceColumn !== undefined) raw = na(ident(sourceColumn), naTokens);
    else if (constant !== undefined) {
      params[`k${i}`] = constant;
      raw = `$k${i}::VARCHAR`;
      transformations.push({ step: 'constant', detail: `${column.name} = "${constant}" for every row` });
    }
    if (raw === undefined) {
      // Contract-defined derivations only (datasets/experiment.ts): protein_ids is protein_group split on ";".
      if (column.name === 'protein_ids' && mapping.columns.protein_group) {
        transformations.push({ step: 'split', detail: 'protein_ids = protein_group split on ";"' });
        return [
          `${typed(na(ident(mapping.columns.protein_group), naTokens), 'text[]', source.decimal, ';')} AS ${name}`,
        ];
      }
      if (column.type === 'text[]' || column.type === 'double[]') {
        transformations.push({
          step: 'empty_list',
          detail: `${column.name} not in the file: empty list (no values known)`,
        });
        return [`[]::${column.type === 'text[]' ? 'VARCHAR' : 'DOUBLE'}[] AS ${name}`];
      }
      if (column.type === 'json') {
        transformations.push({
          step: 'empty_object',
          detail: `${column.name} not in the file: {} (no values known)`,
        });
        return [`'{}'::JSON AS ${name}`];
      }
      if (!column.nullable) missing.push(column.name);
      return [`NULL AS ${name}`];
    }
    const value = typed(raw, column.type, source.decimal, separator);
    return column.type === 'text'
      ? [`${value} AS ${name}`]
      : [`${value} AS ${name}`, `${raw} AS ${ident(`__raw_${column.name}`)}`];
  });
  if (missing.length) {
    throw new ImportError('unmapped_columns', `Map a column or give a constant for: ${missing.join(', ')}.`);
  }
  return {
    kind: mapping.kind,
    setup: [],
    select: `SELECT ${exprs.join(', ')} FROM ${source.table}`,
    params,
    rules: [],
    transformations: [
      { step: 'map_columns', detail: 'Source columns mapped to the contract (see source.mapping)' },
      ...transformations,
    ],
    naTokens,
    toolVersion: 'not applicable',
    mapping: mapping.columns,
  };
}

/** Any CSV/TSV with a saved mapping → any importable kind (SPEC §6.3). */
export const customTabular: Importer = {
  key: 'custom_tabular',
  label: 'Custom table with a column mapping',
  kind: 'protein_quant',
  tool: 'custom',
  version: '1.0.0',
  formats: ['csv', 'tsv', 'text'],
  detect: () => false,
  build(source, ctx) {
    const parsed = TabularMappingSchema.safeParse(ctx.options);
    if (!parsed.success)
      throw new ImportError(
        'needs_mapping',
        'custom_tabular needs a mapping: kind, columns and optional constants.',
      );
    return buildTabular(source, ctx, parsed.data);
  },
};
