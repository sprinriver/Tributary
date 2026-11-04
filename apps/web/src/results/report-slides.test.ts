import { describe, expect, it } from 'vitest';
import { reportSlides } from './report-slides.ts';

const input = {
  experiment: 'ONC-DIA-05',
  program: 'ONC',
  version: 2,
  assay: 'proteomics dia',
  samples: 6,
  generatedAt: '2026-11-04',
  methods: 'A '.repeat(700).trim(),
  thresholds: { fc: 1, p: 0.05 },
  contrasts: [
    {
      label: 'CPD-1@1 µM vs DMSO',
      up: 12,
      down: 7,
      image: 'data:image/png;base64,AAAA',
      top: [{ feature: 'P04637', genes: 'TP53', log2_fc: -2.5913, adj_p: 6.54e-23 }],
    },
  ],
};

describe('PowerPoint report', () => {
  it('REP-02: title, methods, one slide per contrast with counts and volcano, and its top hits', () => {
    const slides = reportSlides(input);
    expect(slides.map((s) => s.title)).toEqual([
      'ONC-DIA-05 · version 2',
      'Methods',
      'Methods (continued)',
      'CPD-1@1 µM vs DMSO',
      'CPD-1@1 µM vs DMSO: top hits',
    ]);
    expect(slides[0]!.lines).toEqual(['ONC · proteomics dia · 6 samples', 'Report generated 2026-11-04']);
    const contrast = slides[3]!;
    expect(contrast.image).toBe('data:image/png;base64,AAAA');
    expect(contrast.lines).toEqual([
      '12 up, 7 down at |log2 FC| ≥ 1 and adjusted p ≤ 0.05',
      'Display thresholds, not part of the tool’s test. log2 FC = log2(numerator / denominator).',
    ]);
    expect(slides[4]!.table).toEqual([
      ['feature', 'genes', 'log2 FC', 'adjusted p'],
      ['P04637', 'TP53', '-2.59', '6.54e-23'],
    ]);
  });
});
