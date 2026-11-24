import { describe, expect, it } from 'vitest';
import { normaliseId } from './ids.ts';

describe('identifier matching for enrichment', () => {
  it('ENR-03: UniProt isoform suffixes match the canonical accession; gene symbols are kept as given', () => {
    expect(normaliseId('P12345-2', 'uniprot_accession')).toBe('P12345');
    expect(normaliseId('A0A024R161', 'uniprot_accession')).toBe('A0A024R161');
    // Symbols are case-sensitive across species (TP53 vs Trp53): never folded.
    expect(normaliseId('Trp53', 'gene_symbol')).toBe('Trp53');
    expect(normaliseId(' TP53 ', 'gene_symbol')).toBe('TP53');
  });
});
