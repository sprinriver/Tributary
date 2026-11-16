// Identifier matching between a release and a gene-set collection (Phase 24). Recorded in every result's provenance.

export type IdType = 'gene_symbol' | 'uniprot_accession';

/**
 * UniProt accessions lose an isoform suffix ("P12345-2" → "P12345"; https://www.uniprot.org/help/accession_numbers),
 * because collections annotate canonical entries. Gene symbols are only trimmed: case differs between species
 * (human TP53, mouse Trp53), so it is never folded.
 */
export function normaliseId(id: string, type: IdType): string {
  const trimmed = id.trim();
  return type === 'uniprot_accession' ? trimmed.replace(/-\d+$/, '') : trimmed;
}
