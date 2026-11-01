import type { DatasetKind } from '@tributary/contracts';
import { buildTabular } from '../custom_tabular/index.ts';
import { ImportError } from '../errors.ts';
import type { Importer } from '../types.ts';

// Reference imports (SPEC M5): customer registry exports with the column names of the contracts. Columns that are
// absent stay empty (nullable) — never guessed.

function preset(
  key: string,
  label: string,
  kind: DatasetKind,
  columns: string[],
  required: string[],
  constantsFromOptions: string[] = [],
): Importer {
  return {
    key,
    label,
    kind,
    tool: 'reference table',
    version: '1.0.0',
    formats: ['csv', 'tsv', 'text'],
    detect: (header) => required.every((c) => header.includes(c)),
    build(source, ctx) {
      const mapped = Object.fromEntries(columns.filter((c) => source.columns.includes(c)).map((c) => [c, c]));
      const options = ctx.options ?? {};
      const constants: Record<string, string> = {};
      for (const name of constantsFromOptions) {
        if (typeof options[name] === 'string' && options[name]) constants[name] = options[name];
      }
      const missing = constantsFromOptions.filter((c) => !(c in constants) && !(c in mapped));
      if (missing.length) throw new ImportError('needs_options', `${label} needs: ${missing.join(', ')}.`);
      return buildTabular(source, ctx, { kind, columns: mapped, constants });
    },
  };
}

export const referenceCompound = preset(
  'reference_compound',
  'Compounds (registry export)',
  'compound',
  ['compound_id', 'batch_id', 'name', 'smiles', 'inchikey'],
  ['compound_id', 'smiles'],
);
export const referenceCompoundProperty = preset(
  'reference_compound_property',
  'Compound properties',
  'compound_property',
  ['compound_id', 'batch_id', 'property', 'value', 'unit', 'qualifier', 'assay_category', 'assay_name'],
  ['compound_id', 'property', 'value', 'qualifier'],
);
export const referenceTargetAnnotation = preset(
  'reference_target_annotation',
  'Target annotations',
  'target_annotation',
  ['uniprot_accession', 'gene_symbol', 'family', 'key', 'value'],
  ['uniprot_accession', 'key', 'value'],
);
/** Versioned by source and source release (e.g. UniProt 2026_04), given at import when not in the file. */
export const referenceIdMapping = preset(
  'reference_id_mapping',
  'ID mapping (UniProt ↔ gene ↔ Ensembl)',
  'id_mapping',
  ['uniprot_accession', 'gene_symbol', 'ensembl_gene_id', 'species', 'source', 'source_release'],
  ['uniprot_accession', 'ensembl_gene_id'],
  ['species', 'source', 'source_release'],
);
