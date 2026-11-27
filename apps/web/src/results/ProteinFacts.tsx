import type { ApiResponse } from '../api.ts';

type Annotation = ApiResponse<'getProtein'>['annotations'][number];

const LABELS: Record<string, string> = {
  protein_name: 'Name',
  function: 'Function',
  subcellular_location: 'Location in the cell',
  organism: 'Organism',
};
const ORDER = Object.keys(LABELS);
/** UniProt function text can run to thousands of characters: show the start, the rest on request. */
const SHORT = 360;

/** The text up to the end of the last sentence within `SHORT` characters (or the whole text if short). */
export function shortText(text: string): string | null {
  if (text.length <= SHORT) return null;
  const head = text.slice(0, SHORT);
  const end = head.lastIndexOf('. ');
  return end > SHORT / 3 ? head.slice(0, end + 1) : `${head.trimEnd()}…`;
}

function LongText({ text }: { text: string }) {
  const short = shortText(text);
  if (!short) return <>{text}</>;
  return (
    <details>
      <summary style={{ cursor: 'pointer' }}>
        {short} <span style={{ color: 'var(--accent, #1d4ed8)' }}>Show full text</span>
      </summary>
      <p style={{ margin: '6px 0 0' }}>{text}</p>
    </details>
  );
}

/** Facts about the protein from public sources (UNI-02), with the source release and retrieval date. */
export function ProteinFactsSection({ annotations }: { annotations: Annotation[] }) {
  const facts = annotations
    .filter((a) => a.source !== null && a.value !== null && a.key in LABELS)
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  if (facts.length === 0) return null;
  // One line per source and release (facts from one refresh share them).
  const sources = [...new Map(facts.map((f) => [`${f.source}|${f.source_release}`, f])).values()];
  return (
    <section className="card stack" role="region" aria-label="About this protein">
      <h2 style={{ margin: 0 }}>About this protein</h2>
      <dl className="stack" style={{ margin: 0, gap: 8 }}>
        {facts.map((f) => (
          <div
            key={f.key}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(8rem, 12rem) 1fr', gap: 12 }}
          >
            <dt style={{ fontWeight: 600 }}>{LABELS[f.key]}</dt>
            <dd style={{ margin: 0, maxWidth: '70ch' }}>
              <LongText text={f.value ?? ''} />
            </dd>
          </div>
        ))}
      </dl>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9em' }}>
        {sources
          .map(
            (s) =>
              `Source: ${s.source}${s.source_release ? ` release ${s.source_release}` : ''}` +
              (s.retrieved_at ? `, retrieved ${new Date(s.retrieved_at).toLocaleDateString()}` : ''),
          )
          .join(' · ')}
        {sources.some((s) => s.source === 'UniProt') ? ' · UniProt data: CC BY 4.0' : ''}
      </p>
    </section>
  );
}
