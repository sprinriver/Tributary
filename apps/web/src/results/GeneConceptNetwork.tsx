import type { EnrichmentHitGene, EnrichmentTerm } from '@tributary/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cnetElements, NETWORK_TERMS } from './cnet.ts';

/** Diverging colour for log2 FC (blue = down, red = up), clamped at ±3. A display transform only. */
export function fcColour(fc: number): string {
  const t = Math.max(-1, Math.min(1, fc / 3));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * Math.abs(t));
  return t >= 0
    ? `rgb(${mix(247, 178)}, ${mix(247, 24)}, ${mix(247, 43)})`
    : `rgb(${mix(247, 33)}, ${mix(247, 102)}, ${mix(247, 172)})`;
}
export const MULTI = '#9aa5b1';
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2));

/**
 * Gene–concept network (Phase 30, NET-02): the top enriched sets and their hit genes. Gene colour is the log2 FC of
 * the gene's one hit feature; a gene that is a hit in several features is grey (no single value is chosen).
 */
export function GeneConceptNetwork({
  terms,
  hitGenes,
  contrast,
}: {
  terms: EnrichmentTerm[];
  hitGenes: EnrichmentHitGene[];
  contrast: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const net = useMemo(() => cnetElements(terms, hitGenes), [terms, hitGenes]);
  const genes = net.nodes.filter((n) => n.data.kind === 'gene');

  useEffect(() => {
    if (!host.current || net.nodes.length === 0) return;
    let cy: { destroy(): void } | undefined;
    let cancelled = false;
    void import('cytoscape')
      .then(({ default: cytoscape }) => {
        if (cancelled || !host.current) return;
        cy = cytoscape({
          container: host.current,
          elements: [...net.nodes, ...net.edges],
          layout: {
            name: 'cose',
            animate: false,
            randomize: false,
            nodeRepulsion: () => 9000,
            idealEdgeLength: () => 70,
          },
          minZoom: 0.3,
          maxZoom: 3,
          style: [
            {
              selector: 'node[kind = "term"]',
              style: {
                shape: 'round-rectangle',
                'background-color': '#3e4c59',
                label: 'data(label)',
                color: '#1f2933',
                'font-size': 11,
                'text-valign': 'bottom',
                'text-margin-y': 4,
                width: 'mapData(degree, 1, 30, 18, 46)',
                height: 'mapData(degree, 1, 30, 18, 46)',
              },
            },
            {
              selector: 'node[kind = "gene"]',
              style: {
                'background-color': (n: { data(k: string): unknown }) => {
                  const fc = n.data('log2_fc');
                  return typeof fc === 'number' ? fcColour(fc) : MULTI;
                },
                'border-width': 1,
                'border-color': '#52606d',
                'border-style': (n: { data(k: string): unknown }) =>
                  typeof n.data('log2_fc') === 'number' ? 'solid' : 'dashed',
                label: 'data(label)',
                color: '#1f2933',
                'font-size': 9,
                width: 14,
                height: 14,
              },
            },
            { selector: 'edge', style: { width: 1, 'line-color': '#cbd2d9', 'curve-style': 'haystack' } },
          ],
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      cy?.destroy();
    };
  }, [net]);

  if (net.nodes.length === 0) return null;
  return (
    <section role="region" aria-label="Gene–concept network" className="stack">
      <h3 style={{ margin: 0, fontSize: '1rem' }}>Gene–concept network</h3>
      <p className="hint" style={{ margin: 0 }}>
        Top {net.shownTerms} gene sets (of {net.shownTerms + net.hiddenTerms}) and their hit genes ·{' '}
        {contrast}. Gene colour: log2 FC (blue down, red up, ±3 and beyond at full colour); grey with a dashed
        edge: a hit in several features (no single value).
      </p>
      {error && <p role="alert">The network could not be drawn: {error}</p>}
      <div
        ref={host}
        role="img"
        aria-label={`Network of ${net.shownTerms} gene sets and ${genes.length} hit genes; the table below lists the same links`}
        style={{
          width: '100%',
          height: 460,
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #d9e2ec',
        }}
      />
      <table aria-label="Gene–concept links" className="data-table">
        <thead>
          <tr>
            {['gene', 'log2 FC', 'hit features', 'direction', `sets (of the top ${NETWORK_TERMS})`].map(
              (h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {genes.map((g) => (
            <tr key={g.data.id}>
              <td>{g.data.label}</td>
              <td>{fmt(g.data.log2_fc)}</td>
              <td>{g.data.features}</td>
              <td>{g.data.direction}</td>
              <td>
                {net.edges
                  .filter((e) => e.data.target === g.data.id)
                  .map((e) => net.nodes.find((n) => n.data.id === e.data.source)!.data.label)
                  .join('; ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
