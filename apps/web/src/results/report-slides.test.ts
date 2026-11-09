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

describe('PowerPoint report sections (Phase 39)', () => {
  const full = {
    ...input,
    methods: 'Short methods.',
    qc: { dataset: 'DIA-NN protein groups', tool: 'DIA-NN 1.9', image: 'data:image/png;base64,QC' },
    enrichment: {
      collection: 'Reactome pathways (human) — Reactome 94',
      settings:
        'Hits: adjusted p ≤ 0.05 and |log2 FC| ≥ 1, both directions; sets of 10–500; universe: measured',
      contrasts: [
        {
          label: 'CPD-1@1 µM vs DMSO',
          terms: [{ id: 'R-HSA-1', name: 'Cell cycle', overlap: 8, size: 120, fold: 3.456, adj_p: 0.000123 }],
        },
        { label: 'CPD-2@1 µM vs DMSO', terms: [] },
      ],
    },
    dose: {
      dataset: 'CurveCurator curves',
      method: 'CurveCurator',
      counts: { up: 3, down: 2, not: 40, unclear: null },
      image: null,
      top: [
        {
          feature: 'P04637',
          genes: 'TP53',
          compound: 'CPD-000001',
          pec50: 7.1234,
          regulation: 'down',
          fdr: 0.0012,
        },
        { feature: 'Q9Y6K9', genes: '', compound: 'CPD-000001', pec50: null, regulation: 'up', fdr: null },
      ],
    },
  };

  it('REP-04: a QC slide with the QC panel image and what it shows comes after the methods', () => {
    const slides = reportSlides(full);
    expect(slides.map((s) => s.title).slice(0, 3)).toEqual(['ONC-DIA-05 · version 2', 'Methods', 'QC']);
    expect(slides[2]).toEqual({
      title: 'QC',
      lines: [
        'DIA-NN protein groups (DIA-NN 1.9)',
        'IDs per run, data completeness, CV and log2 intensity distributions. Intensities ≤ 0 are left out of the log2 view.',
      ],
      image: 'data:image/png;base64,QC',
    });
  });

  it('REP-05: enrichment slides state the collection and hit definition, then the top terms per contrast', () => {
    const slides = reportSlides(full);
    const at = slides.findIndex((s) => s.title === 'Pathway enrichment');
    expect(at).toBeGreaterThan(slides.findIndex((s) => s.title === 'CPD-1@1 µM vs DMSO: top hits'));
    expect(slides[at]!.lines).toEqual([
      'Gene sets: Reactome pathways (human) — Reactome 94',
      'Hits: adjusted p ≤ 0.05 and |log2 FC| ≥ 1, both directions; sets of 10–500; universe: measured',
      'Over-representation (hypergeometric), Benjamini–Hochberg adjusted.',
    ]);
    expect(slides[at + 1]).toEqual({
      title: 'CPD-1@1 µM vs DMSO: enrichment',
      table: [
        ['term', 'name', 'hits / set size', 'fold enrichment', 'adjusted p'],
        ['R-HSA-1', 'Cell cycle', '8 / 120', '3.46', '1.23e-4'],
      ],
    });
    expect(slides[at + 2]).toEqual({
      title: 'CPD-2@1 µM vs DMSO: enrichment',
      lines: ['No gene set was tested: no set had enough measured members within the size limits.'],
    });
  });

  it('REP-06: a dose-response slide counts curves per regulation class, then a table of the top curves', () => {
    const slides = reportSlides(full);
    const at = slides.findIndex((s) => s.title === 'Dose-response');
    expect(at).toBe(slides.length - 2);
    expect(slides[at]).toEqual({
      title: 'Dose-response',
      lines: [
        'CurveCurator curves: 3 up, 2 down, 40 not regulated, unclear not counted (regulation classes from CurveCurator)',
        'pEC50 = −log10(EC50 in M).',
      ],
    });
    expect(slides[at + 1]!.table).toEqual([
      ['feature', 'genes', 'compound', 'pEC50', 'regulation', 'FDR'],
      ['P04637', 'TP53', 'CPD-000001', '7.12', 'down', '1.20e-3'],
      ['Q9Y6K9', '', 'CPD-000001', '—', 'up', '—'],
    ]);
  });
});
