import { col, enumRule, opt, uniqueRule } from './types.ts';
import type { DatasetContract } from './types.ts';

export const compound: DatasetContract = {
  kind: 'compound',
  version: '1.0.0',
  category: 'reference',
  description: "Compounds from the customer's registry export (we never register compounds).",
  columns: [
    col('compound_id', 'text'),
    opt('batch_id', 'text'),
    opt('name', 'text'),
    opt('smiles', 'text'),
    opt('inchikey', 'text'),
    col('external_ids', 'json'),
    col('program_id', 'uuid'),
  ],
  joinKeys: ['compound_id'],
  qualityRules: [uniqueRule('one_row_per_compound_batch', ['compound_id', 'batch_id'])],
};

export const compoundProperty: DatasetContract = {
  kind: 'compound_property',
  version: '1.0.0',
  category: 'reference',
  description: 'Compound properties (ADME, physchem, binding, …); activities as −log molar where relevant.',
  columns: [
    col('compound_id', 'text'),
    opt('batch_id', 'text'),
    col('property', 'text'),
    opt('value', 'double'),
    opt('unit', 'text'),
    col('qualifier', 'text'),
    col('assay_category', 'text'),
    opt('assay_name', 'text'),
  ],
  joinKeys: ['compound_id'],
  qualityRules: [
    enumRule('qualifier', ['=', '<', '>'], 'SPEC §4 CompoundProperty'),
    enumRule(
      'assay_category',
      ['ADME', 'physchem', 'binding', 'functional', 'tox'],
      'SPEC §4 CompoundProperty',
    ),
  ],
};

export const targetAnnotation: DatasetContract = {
  kind: 'target_annotation',
  version: '1.0.0',
  category: 'reference',
  description: 'Generic key/value annotations per target protein.',
  columns: [
    col('uniprot_accession', 'text'),
    opt('gene_symbol', 'text'),
    opt('family', 'text'),
    col('key', 'text'),
    opt('value', 'text'),
  ],
  joinKeys: ['uniprot_accession', 'gene_symbol'],
  qualityRules: [],
};

export const idMapping: DatasetContract = {
  kind: 'id_mapping',
  version: '1.0.0',
  category: 'reference',
  description: 'UniProt accession ↔ gene symbol ↔ Ensembl gene, versioned by source release.',
  columns: [
    col('uniprot_accession', 'text'),
    opt('gene_symbol', 'text'),
    opt('ensembl_gene_id', 'text'),
    col('species', 'text', { description: 'NCBITaxon CURIE' }),
    col('source', 'text', { description: 'e.g. UniProt' }),
    col('source_release', 'text', { description: 'e.g. the UniProt release used' }),
  ],
  joinKeys: ['uniprot_accession', 'gene_symbol'],
  qualityRules: [],
};
