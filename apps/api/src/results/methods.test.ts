import { describe, expect, it } from 'vitest';
import { methodsParagraph, type MethodsInput } from './methods.ts';

const input: MethodsInput = {
  experiment: {
    name: 'ONC dose series',
    assay_type: 'proteomics_dia',
    species: 'Homo sapiens',
    sample_count: 6,
  },
  run: {
    pipeline_name: 'Demo DIA pipeline (local)',
    pipeline_repo: 'pipelines/demo',
    revision: 'local',
    runner: 'local',
    params: { toptable: '/fixtures/x.tsv', fdr: 0.01 },
  },
  releases: [
    {
      kind: 'protein_quant',
      importer: 'diann_pg_matrix',
      tool: 'DIA-NN',
      tool_version: '1.9.2',
      method: null,
      adj_method: null,
    },
    {
      kind: 'differential_abundance',
      importer: 'limma_toptable',
      tool: 'limma',
      tool_version: '3.62.0',
      method: 'limma',
      adj_method: 'BH',
    },
  ],
  contrasts: ['CPD-000005@1 µM vs DMSO'],
  thresholds: { fc: 1, p: 0.05 },
};

describe('methods paragraph', () => {
  it('RES-01: names the pipeline and its revision, tools with versions, contrasts and thresholds', () => {
    const text = methodsParagraph(input);
    expect(text).toContain('Demo DIA pipeline (local)');
    expect(text).toContain('pipelines/demo');
    expect(text).toContain('revision local');
    expect(text).toContain('DIA-NN 1.9.2');
    expect(text).toContain('limma 3.62.0');
    expect(text).toContain('CPD-000005@1 µM vs DMSO');
    expect(text).toContain('|log2 fold change| ≥ 1');
    expect(text).toContain('adjusted p ≤ 0.05');
    expect(text).toContain('Benjamini–Hochberg');
    expect(text).toContain('fdr = 0.01');
    expect(text).toContain('6 samples');
    expect(text).toContain('Homo sapiens');
  });

  it('RES-01: is deterministic (same input, same text; parameter and release order do not matter)', () => {
    const shuffled: MethodsInput = {
      ...input,
      run: { ...input.run!, params: { fdr: 0.01, toptable: '/fixtures/x.tsv' } },
      releases: [...input.releases].reverse(),
    };
    expect(methodsParagraph(shuffled)).toBe(methodsParagraph(input));
  });

  it('RES-01: says when results were imported without a recorded pipeline run, and when tool versions are unknown', () => {
    const text = methodsParagraph({
      ...input,
      run: null,
      releases: [{ ...input.releases[1]!, tool_version: 'unknown', adj_method: 'BY' }],
    });
    expect(text).toContain('imported from tool outputs (no pipeline run recorded)');
    expect(text).toContain('limma (version not recorded)');
    expect(text).toContain('Benjamini–Yekutieli');
  });
});
