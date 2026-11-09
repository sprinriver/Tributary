// The PowerPoint report as a plan of slides (Phase 33, REP-02): pure, so its content is unit-tested; pptx.ts draws it.

export interface ReportInput {
  experiment: string;
  program: string;
  version: number;
  assay: string;
  samples: number;
  generatedAt: string;
  methods: string;
  thresholds: { fc: number; p: number };
  contrasts: {
    label: string;
    up: number | null;
    down: number | null;
    /** PNG data URL of the rendered volcano, when it could be exported. */
    image: string | null;
    top: { feature: string; genes: string; log2_fc: number; adj_p: number }[];
  }[];
  /** QC panel of the protein-quantity release (Phase 39). */
  qc?: { dataset: string; tool: string | null; image: string | null };
  /** Pathway enrichment per contrast, with the report's hit thresholds (Phase 39). */
  enrichment?: {
    collection: string;
    settings: string;
    /** The API's method and adjustment (provenance); the page always passes it. */
    method?: string;
    contrasts: EnrichmentContrast[];
  };
  /** Dose-response curves (Phase 39). Counts per regulation class as the source tool classed them. */
  dose?: {
    dataset: string;
    method: string | null;
    /** null: not available (loading or failed). */
    counts: Record<DoseClass, number | null>;
    /** Classes whose count reached the query service's cap: there are more than shown. */
    capped?: DoseClass[];
    image: string | null;
    top: DoseRow[];
  };
}

export type DoseClass = 'up' | 'down' | 'not' | 'unclear';

export interface EnrichmentContrast {
  label: string;
  /** Why enrichment was not run for this contrast (e.g. no feature passes the hit thresholds). */
  skipped?: string;
  /** "8 hits of 900 background; 40 sets tested; 1 at adjusted p ≤ 0.05". */
  summary: string;
  /** The API's recorded transformations for this contrast. */
  notes: string[];
  terms: EnrichmentRow[];
}

export interface EnrichmentRow {
  id: string;
  name: string;
  overlap: number;
  size: number;
  fold: number;
  adj_p: number;
}

export interface DoseRow {
  feature: string;
  genes: string;
  compound: string;
  pec50: number | null;
  regulation: string;
  fdr: number | null;
}

// What shapeQc (apps/api/src/charts/omics-shapes.ts) draws for this spec: x is the sample, no colour groups.
export const QC_CAPTION =
  'IDs and missing values per sample, CV across all runs (conditions pooled) and log2 intensity distributions. Intensities that are missing or ≤ 0 count as not quantified.';
export const ENRICHMENT_METHOD = 'Over-representation (hypergeometric), Benjamini–Hochberg adjusted.';
export const NO_TERMS = 'No gene set was tested: no set had enough measured members within the size limits.';
export const PEC50_NOTE = 'pEC50 = −log10(EC50 in M).';

export const NO_HITS = 'No feature passes the hit thresholds: enrichment not run.';
export const FDR_HEADER = 'FDR (q-value)';
export const PEC50_ONLY = 'ranked by pEC50 only: no FDR in the source';

// "unclear" is the importers' class for a curve the tool left without a class (CurveCurator SOURCE.md).
const CLASS_NAMES: Record<DoseClass, string> = {
  up: 'up',
  down: 'down',
  not: 'not regulated',
  unclear: 'unclassified',
};

/** "3 up, 2 down, > 1000000 not regulated, unclassified not available (classes from …)". */
export function doseCounts(
  counts: Record<DoseClass, number | null>,
  method: string | null,
  capped: DoseClass[] = [],
): string {
  const parts = (Object.keys(CLASS_NAMES) as DoseClass[]).map((k) =>
    counts[k] === null
      ? `${CLASS_NAMES[k]} not available`
      : `${capped.includes(k) ? '> ' : ''}${counts[k]} ${CLASS_NAMES[k]}`,
  );
  return `${parts.join(', ')}${method ? ` (classes from ${method}; unclassified: the tool gave no class)` : ''}`;
}

/** True when no curve shown has an FDR (the ranking then falls back to pEC50). */
export const noFdr = (top: DoseRow[]) => top.length > 0 && top.every((d) => d.fdr === null);

export const ENRICHMENT_HEAD = [
  'term',
  'name',
  'hits / measured set members',
  'fold enrichment',
  'adjusted p',
];
export const DOSE_HEAD = ['feature', 'genes', 'compound', 'pEC50', 'regulation', FDR_HEADER];

export const enrichmentCells = (t: EnrichmentRow) => [
  t.id,
  t.name,
  `${t.overlap} / ${t.size}`,
  t.fold.toFixed(2),
  t.adj_p.toExponential(2),
];
export const doseCells = (d: DoseRow) => [
  d.feature,
  d.genes,
  d.compound,
  d.pec50 === null ? '—' : d.pec50.toFixed(2),
  d.regulation,
  d.fdr === null ? '—' : d.fdr.toExponential(2),
];

export interface SlideSpec {
  title: string;
  lines?: string[];
  image?: string;
  table?: string[][];
}

/** Characters of methods text per slide (split between words). */
const METHODS_CHARS = 900;

function chunks(text: string, size: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > size) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}

export function reportSlides(r: ReportInput): SlideSpec[] {
  const slides: SlideSpec[] = [
    {
      title: `${r.experiment} · version ${r.version}`,
      lines: [`${r.program} · ${r.assay} · ${r.samples} samples`, `Report generated ${r.generatedAt}`],
    },
    ...chunks(r.methods, METHODS_CHARS).map((text, i) => ({
      title: i === 0 ? 'Methods' : 'Methods (continued)',
      lines: [text],
    })),
  ];
  if (r.qc)
    slides.push({
      title: 'QC',
      lines: [r.qc.tool ? `${r.qc.dataset} (${r.qc.tool})` : r.qc.dataset, QC_CAPTION],
      ...(r.qc.image ? { image: r.qc.image } : {}),
    });
  for (const c of r.contrasts) {
    slides.push({
      title: c.label,
      lines: [
        c.up === null || c.down === null
          ? 'Hit counts unavailable'
          : `${c.up} up, ${c.down} down at |log2 FC| ≥ ${r.thresholds.fc} and adjusted p ≤ ${r.thresholds.p}`,
        'Display thresholds, not part of the tool’s test. log2 FC = log2(numerator / denominator).',
      ],
      ...(c.image ? { image: c.image } : {}),
    });
    if (c.top.length)
      slides.push({
        title: `${c.label}: top hits`,
        table: [
          ['feature', 'genes', 'log2 FC', 'adjusted p'],
          ...c.top.map((h) => [h.feature, h.genes, h.log2_fc.toFixed(2), h.adj_p.toExponential(2)]),
        ],
      });
  }
  if (r.enrichment) {
    const e = r.enrichment;
    slides.push({
      title: 'Pathway enrichment',
      lines: [
        `Gene sets: ${e.collection}`,
        e.settings,
        e.method ?? ENRICHMENT_METHOD,
        ...e.contrasts.map((c) => `${c.label}: ${c.skipped ?? c.summary}`),
      ],
    });
    for (const c of e.contrasts) {
      if (c.skipped) continue;
      slides.push(
        c.terms.length
          ? {
              title: `${c.label}: enrichment`,
              table: [ENRICHMENT_HEAD, ...c.terms.map(enrichmentCells)],
            }
          : { title: `${c.label}: enrichment`, lines: [NO_TERMS] },
      );
      if (c.notes.length) slides.push({ title: `${c.label}: enrichment details`, lines: c.notes });
    }
  }
  if (r.dose) {
    const d = r.dose;
    slides.push({
      title: 'Dose-response',
      lines: [`${d.dataset}: ${doseCounts(d.counts, d.method, d.capped)}`, PEC50_NOTE],
      ...(d.image ? { image: d.image } : {}),
    });
    if (d.top.length)
      slides.push({
        title: noFdr(d.top) ? `Dose-response: top curves (${PEC50_ONLY})` : 'Dose-response: top curves',
        table: [DOSE_HEAD, ...d.top.map(doseCells)],
      });
  }
  return slides;
}
