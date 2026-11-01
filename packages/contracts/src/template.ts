import { z } from 'zod';
import { BaseEntityShape, SemverSchema, UuidV7Schema } from './common.ts';

export const AssayTypeKeySchema = z.enum([
  'proteomics_dia',
  'proteomics_dda',
  'proteomics_tmt',
  'rnaseq',
  'crispr_screen',
  'ngs_raw',
]);
export type AssayTypeKey = z.infer<typeof AssayTypeKeySchema>;

export const FieldTypeSchema = z.enum([
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'enum',
  'ontology_term',
  'quantity',
]);

/** SPEC §4 MetadataFieldDef. `searchable` drives search (M9); custom fields belong to one experiment version. */
export const MetadataFieldDefSchema = z
  .object({
    scope: z.enum(['experiment', 'sample']),
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case keys'),
    label: z.string().min(1),
    type: FieldTypeSchema,
    required: z.boolean(),
    searchable: z.boolean(),
    /** Unit Ontology term for quantities, e.g. UO:0000062 (molar). */
    unit: z.string().optional(),
    /** Ontology prefix for ontology_term fields, e.g. NCBITaxon, cellosaurus, UBERON. */
    ontology: z.string().optional(),
    enumValues: z.array(z.string().min(1)).min(1).optional(),
    quantityKind: z.enum(['concentration', 'time']).optional(),
    /** Extra check for text fields. */
    validator: z.enum(['plate_well']).optional(),
  })
  .superRefine((field, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    need(field.type !== 'enum' || !!field.enumValues, 'enumValues', 'Enum fields need enumValues');
    need(field.type !== 'ontology_term' || !!field.ontology, 'ontology', 'Ontology fields need an ontology');
    need(
      field.type !== 'quantity' || !!field.quantityKind,
      'quantityKind',
      'Quantity fields need a quantityKind',
    );
  })
  .meta({ id: 'MetadataFieldDef' });
export type MetadataFieldDef = z.infer<typeof MetadataFieldDefSchema>;

export const MetadataTemplateDefinitionSchema = z.object({
  assay_type: AssayTypeKeySchema,
  version: SemverSchema,
  status: z.enum(['draft', 'published', 'retired']),
  /** Field marked as the row key (unique within an experiment version). */
  key_field: z.string(),
  fields: z.array(MetadataFieldDefSchema),
});
export type MetadataTemplateDefinition = z.infer<typeof MetadataTemplateDefinitionSchema>;

export const MetadataTemplateSchema = z
  .object({ ...BaseEntityShape, ...MetadataTemplateDefinitionSchema.shape, assay_type_id: UuidV7Schema })
  .meta({ id: 'MetadataTemplate' });
export type MetadataTemplate = z.infer<typeof MetadataTemplateSchema>;

type FieldInit = Omit<MetadataFieldDef, 'scope' | 'required' | 'searchable'> &
  Partial<Pick<MetadataFieldDef, 'required' | 'searchable'>>;
const sample = (field: FieldInit): MetadataFieldDef => ({
  scope: 'sample',
  required: false,
  searchable: false,
  ...field,
});

/**
 * Seed sample template for proteomics (SPEC §6.1 canonical columns, aligned with SDRF-Proteomics:
 * https://github.com/bigbio/proteomics-sample-metadata). Ontologies: NCBITaxon, Cellosaurus, UBERON, CL, EFO.
 */
export const SEED_PROTEOMICS_TEMPLATE: MetadataTemplateDefinition = {
  assay_type: 'proteomics_dia',
  version: '1.0.0',
  status: 'published',
  key_field: 'sample_key',
  fields: [
    sample({ key: 'sample_key', label: 'Sample key', type: 'text', required: true, searchable: true }),
    sample({ key: 'source_name', label: 'Source name', type: 'text', required: true }),
    sample({
      key: 'organism',
      label: 'Organism',
      type: 'ontology_term',
      ontology: 'NCBITaxon',
      required: true,
      searchable: true,
    }),
    sample({
      key: 'cell_line',
      label: 'Cell line',
      type: 'ontology_term',
      ontology: 'cellosaurus',
      searchable: true,
    }),
    sample({ key: 'tissue', label: 'Tissue', type: 'ontology_term', ontology: 'UBERON' }),
    sample({ key: 'cell_type', label: 'Cell type', type: 'ontology_term', ontology: 'CL' }),
    sample({ key: 'disease', label: 'Disease', type: 'ontology_term', ontology: 'EFO' }),
    sample({ key: 'compound_id', label: 'Compound ID', type: 'text', searchable: true }),
    sample({ key: 'vehicle', label: 'Vehicle', type: 'text' }),
    sample({
      key: 'dose',
      label: 'Dose',
      type: 'quantity',
      quantityKind: 'concentration',
      unit: 'UO:0000062',
    }),
    sample({ key: 'time', label: 'Time', type: 'quantity', quantityKind: 'time', unit: 'UO:0000032' }),
    sample({ key: 'condition', label: 'Condition', type: 'text', searchable: true }),
    sample({ key: 'replicate_group', label: 'Replicate group', type: 'text' }),
    sample({ key: 'biological_replicate', label: 'Biological replicate', type: 'integer' }),
    sample({ key: 'technical_replicate', label: 'Technical replicate', type: 'integer' }),
    sample({ key: 'plate', label: 'Plate', type: 'text' }),
    sample({ key: 'well', label: 'Well', type: 'text', validator: 'plate_well' }),
    sample({ key: 'fraction', label: 'Fraction', type: 'text' }),
    sample({ key: 'label_channel', label: 'Label channel', type: 'text' }),
    sample({ key: 'raw_file', label: 'Raw file', type: 'text' }),
    sample({ key: 'instrument_run', label: 'Instrument run', type: 'text' }),
  ],
};
