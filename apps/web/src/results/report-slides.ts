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
}

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
  return slides;
}
