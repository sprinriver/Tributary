import type { OntologyTerm } from './common.ts';

/** Resolves a cell value (CURIE or label) to a term of the given ontology. OLS4-backed from Phase 5. */
export interface TermIndex {
  resolve(ontology: string, value: string): OntologyTerm | undefined;
}

export interface SeedTerm extends OntologyTerm {
  ontology: string;
}

/** In-memory index: matches a term by CURIE or label, ignoring case (also of the ontology prefix) and spaces. */
export function createStaticTermIndex(terms: readonly SeedTerm[]): TermIndex {
  const byKey = new Map<string, OntologyTerm>();
  for (const { ontology, id, label } of terms) {
    for (const key of [id, label])
      byKey.set(`${ontology.toLowerCase()}|${key.trim().toLowerCase()}`, { id, label });
  }
  return {
    resolve: (ontology, value) => byKey.get(`${ontology.toLowerCase()}|${value.trim().toLowerCase()}`),
  };
}

/**
 * Seed terms for offline validation and tests until the OLS4 cache exists.
 * Sources: NCBI Taxonomy (https://www.ncbi.nlm.nih.gov/taxonomy) and Cellosaurus (https://www.cellosaurus.org).
 */
export const SEED_TERMS: readonly SeedTerm[] = [
  { ontology: 'NCBITaxon', id: 'NCBITaxon:9606', label: 'Homo sapiens' },
  { ontology: 'NCBITaxon', id: 'NCBITaxon:10090', label: 'Mus musculus' },
  { ontology: 'NCBITaxon', id: 'NCBITaxon:10116', label: 'Rattus norvegicus' },
  { ontology: 'NCBITaxon', id: 'NCBITaxon:9544', label: 'Macaca mulatta' },
  { ontology: 'cellosaurus', id: 'cellosaurus:CVCL_0030', label: 'HeLa' },
  { ontology: 'cellosaurus', id: 'cellosaurus:CVCL_0023', label: 'A-549' },
  { ontology: 'cellosaurus', id: 'cellosaurus:CVCL_0045', label: 'HEK293' },
  { ontology: 'cellosaurus', id: 'cellosaurus:CVCL_0004', label: 'K-562' },
  { ontology: 'cellosaurus', id: 'cellosaurus:CVCL_0031', label: 'MCF-7' },
];
