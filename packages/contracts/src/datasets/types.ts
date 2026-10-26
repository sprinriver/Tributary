import { z } from 'zod';
import { SemverSchema } from '../common.ts';

export const DATASET_KINDS = [
  'protein_quant',
  'precursor_quant',
  'differential_abundance',
  'dose_response',
  'qc_metrics',
  'rnaseq_counts',
  'crispr_gene_summary',
  'compound',
  'compound_property',
  'target_annotation',
  'id_mapping',
  'experiment_version',
  'sample',
  'file_object',
  'pipeline_run',
] as const;
export const DatasetKindSchema = z.enum(DATASET_KINDS).meta({ id: 'DatasetKind' });
export type DatasetKind = z.infer<typeof DatasetKindSchema>;

export const ColumnTypeSchema = z.enum([
  'text',
  'uuid',
  'double',
  'integer',
  'boolean',
  'date',
  'timestamp',
  'text[]',
  'double[]',
  'json',
]);
export type ColumnType = z.infer<typeof ColumnTypeSchema>;

export const DatasetColumnSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  type: ColumnTypeSchema,
  nullable: z.boolean(),
  description: z.string().optional(),
  unit: z.string().optional(),
});
export type DatasetColumn = z.infer<typeof DatasetColumnSchema>;

const RuleBase = {
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  columns: z.array(z.string()).min(1),
  severity: z.enum(['error', 'warn']),
  /** Where the rule comes from: tool docs URL + version, a paper DOI, or a SPEC/CLAUDE.md section. */
  source: z.string().min(1),
};

export const QualityRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    ...RuleBase,
    kind: z.literal('range'),
    min: z.number().optional(),
    minInclusive: z.boolean(),
    max: z.number().optional(),
    maxInclusive: z.boolean(),
  }),
  z.object({ ...RuleBase, kind: z.literal('enum'), values: z.array(z.string()).min(1) }),
  z.object({ ...RuleBase, kind: z.literal('unique') }),
]);
export type QualityRule = z.infer<typeof QualityRuleSchema>;

export const DatasetContractSchema = z
  .object({
    kind: DatasetKindSchema,
    version: SemverSchema,
    /** experiment: rows belong to an experiment version · reference: customer reference data · metadata: live views. */
    category: z.enum(['experiment', 'reference', 'metadata']),
    description: z.string(),
    columns: z.array(DatasetColumnSchema).min(1),
    /** Columns other datasets may join on without the advanced flag (SPEC §6.2 "Declared join keys"). */
    joinKeys: z.array(z.string()),
    qualityRules: z.array(QualityRuleSchema),
  })
  .meta({ id: 'DatasetContract' });
export type DatasetContract = z.infer<typeof DatasetContractSchema>;

/** SPEC §6.2. `protein_ids` / `gene_names` are lists: joins explode them to match `uniprot_accession` / `gene_symbol`. */
export const DECLARED_JOIN_KEYS = [
  'compound_id',
  'uniprot_accession',
  'protein_ids',
  'gene_symbol',
  'gene_names',
  'sample_key',
  'contrast_id',
  'experiment_version_id',
] as const;

// Helpers that keep the contract tables readable.
export const col = (
  name: string,
  type: ColumnType,
  extra: Partial<Omit<DatasetColumn, 'name' | 'type'>> = {},
) => DatasetColumnSchema.parse({ name, type, nullable: false, ...extra });
export const opt = (
  name: string,
  type: ColumnType,
  extra: Partial<Omit<DatasetColumn, 'name' | 'type'>> = {},
) => col(name, type, { ...extra, nullable: true });

const SCIENCE = 'CLAUDE.md Science conventions';
/** p-values in (0, 1] (CLAUDE.md Science conventions). */
export const pValueRule = (column: string): QualityRule => ({
  id: `${column}_range`,
  kind: 'range',
  columns: [column],
  min: 0,
  minInclusive: false,
  max: 1,
  maxInclusive: true,
  severity: 'error',
  source: SCIENCE,
});
/** q-values / FDR in [0, 1]. */
export const probabilityRule = (column: string): QualityRule => ({
  id: `${column}_range`,
  kind: 'range',
  columns: [column],
  min: 0,
  minInclusive: true,
  max: 1,
  maxInclusive: true,
  severity: 'error',
  source: 'Definition of a q-value / false discovery rate',
});
export const nonNegativeRule = (column: string, source: string): QualityRule => ({
  id: `${column}_non_negative`,
  kind: 'range',
  columns: [column],
  min: 0,
  minInclusive: true,
  maxInclusive: true,
  severity: 'error',
  source,
});
export const enumRule = (column: string, values: string[], source = 'SPEC §6.2'): QualityRule => ({
  id: `${column}_values`,
  kind: 'enum',
  columns: [column],
  values,
  severity: 'error',
  source,
});
export const uniqueRule = (id: string, columns: string[]): QualityRule => ({
  id,
  kind: 'unique',
  columns,
  severity: 'error',
  source: 'SPEC §6.2 (one row per key)',
});
