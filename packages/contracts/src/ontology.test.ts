import { describe, expect, it } from 'vitest';
import { createStaticTermIndex, SEED_PROTEOMICS_TEMPLATE, SEED_TERMS } from './index.ts';

describe('ontology term index', () => {
  it('CON-01: every ontology field of the seed template resolves its seed terms', () => {
    const index = createStaticTermIndex(SEED_TERMS);
    const cellLine = SEED_PROTEOMICS_TEMPLATE.fields.find((f) => f.key === 'cell_line');
    const organism = SEED_PROTEOMICS_TEMPLATE.fields.find((f) => f.key === 'organism');
    expect(index.resolve(cellLine?.ontology ?? '', 'HeLa')).toEqual({
      id: 'cellosaurus:CVCL_0030',
      label: 'HeLa',
    });
    expect(index.resolve(organism?.ontology ?? '', 'homo sapiens')?.id).toBe('NCBITaxon:9606');
  });

  it('CON-01: ontology prefixes match regardless of case', () => {
    const index = createStaticTermIndex(SEED_TERMS);
    expect(index.resolve('CELLOSAURUS', 'cellosaurus:CVCL_0030')?.label).toBe('HeLa');
  });
});
