import {
  InteractionNetworkBodySchema,
  type InteractionNetwork,
  type InteractionNetworkBody,
} from '@tributary/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { fcColour, MULTI } from './GeneConceptNetwork.tsx';

type Draft = {
  collection_id: string;
  contrast_label: string;
  direction: 'up' | 'down' | 'both';
  min_score: string;
};
const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2));

/** Draws the network; the table next to it lists the same edges. Colours as in the gene–concept network. */
function NetworkView({ net }: { net: InteractionNetwork }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!host.current || net.nodes.length === 0) return;
    let cy: { destroy(): void } | undefined;
    let cancelled = false;
    void import('cytoscape')
      .then(({ default: cytoscape }) => {
        if (cancelled || !host.current) return;
        cy = cytoscape({
          container: host.current,
          elements: [
            ...net.nodes.map((n) => ({ data: { id: n.id, label: n.id, log2_fc: n.log2_fc } })),
            ...net.edges.map((e) => ({
              data: { id: `${e.a}|${e.b}`, source: e.a, target: e.b, score: e.score },
            })),
          ],
          layout: { name: 'cose', animate: false, randomize: false, nodeRepulsion: () => 9000 },
          minZoom: 0.3,
          // Small networks are not blown up to fill the frame.
          maxZoom: 1.4,
          style: [
            {
              selector: 'node',
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
                'font-size': 10,
                width: 16,
                height: 16,
              },
            },
            {
              selector: 'edge',
              // Thicker = higher score.
              style: { width: 'mapData(score, 0, 1000, 0.5, 4)', 'line-color': '#9aa5b1' },
            },
          ],
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      cy?.destroy();
    };
  }, [net]);
  return (
    <>
      {error && <p role="alert">The network could not be drawn: {error}</p>}
      <div
        ref={host}
        role="img"
        aria-label={`Network of ${net.nodes.length} hit genes and ${net.edges.length} interactions; the table below lists the same interactions`}
        style={{
          width: '100%',
          height: 420,
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #d9e2ec',
        }}
      />
    </>
  );
}

/**
 * Interaction network of one contrast's hits (Phase 45, PPI-04): which hits are known or predicted to interact,
 * from an imported collection such as STRING. The API selects hits and edges; this panel only shows them.
 */
export function InteractionPanel({ release, contrasts }: { release: string; contrasts: string[] }) {
  const collections = useQuery({
    queryKey: ['interaction-collections'],
    queryFn: () => api('listInteractionCollections'),
  });
  const [draft, setDraft] = useState<Draft>({
    collection_id: '',
    contrast_label: contrasts[0] ?? '',
    direction: 'both',
    min_score: '700',
  });
  const run = useMutation({
    mutationFn: (body: InteractionNetworkBody) => api('interactionNetwork', { body }),
  });
  const collection = draft.collection_id || collections.data?.items[0]?.id || '';
  const parsed = InteractionNetworkBodySchema.safeParse({
    release_id: release,
    collection_id: collection,
    ...(contrasts.length > 1 ? { contrast_label: draft.contrast_label } : {}),
    direction: draft.direction,
    min_score: draft.min_score.trim() === '' ? Number.NaN : Number(draft.min_score),
  });
  const errors = parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? ''), i.message]));
  const set = (key: keyof Draft) => (value: string) => {
    run.reset(); // a shown network always matches the controls
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const heading = <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Interaction network</h2>;
  if (collections.data && collections.data.items.length === 0)
    return (
      <section role="region" aria-label="Interaction network" className="stack">
        {heading}
        <p className="hint">
          No interaction collections yet: a system administrator imports STRING or an in-house network.
        </p>
      </section>
    );
  const net = run.data;
  const fc = new Map(net?.nodes.map((n) => [n.id, n]) ?? []);
  const c = net?.provenance.counts;
  return (
    <section role="region" aria-label="Interaction network" className="stack">
      {heading}
      <ErrorMessage error={collections.error} />
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span>Interactions</span>
          <select value={collection} onChange={(e) => set('collection_id')(e.target.value)}>
            {collections.data?.items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} — {x.source} {x.source_release}
              </option>
            ))}
          </select>
        </label>
        {contrasts.length > 1 && (
          <label className="stack" style={{ gap: 4 }}>
            <span>Contrast for the network</span>
            <select value={draft.contrast_label} onChange={(e) => set('contrast_label')(e.target.value)}>
              {contrasts.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        )}
        <label className="stack" style={{ gap: 4 }}>
          <span>Hits</span>
          <select value={draft.direction} onChange={(e) => set('direction')(e.target.value)}>
            <option value="both">up and down</option>
            <option value="up">up</option>
            <option value="down">down</option>
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span>Minimum score</span>
          <input
            type="number"
            min={0}
            max={1000}
            step={50}
            value={draft.min_score}
            onChange={(e) => set('min_score')(e.target.value)}
            aria-invalid={!!errors.min_score}
          />
          {errors.min_score && <span className="error">A whole number from 0 to 1000.</span>}
        </label>
        <button
          type="button"
          className="primary"
          disabled={!parsed.success || run.isPending}
          onClick={() => parsed.success && run.mutate(parsed.data)}
        >
          {run.isPending ? 'Loading…' : 'Show network'}
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Hits: adjusted p ≤ 0.05 and |log2 FC| ≥ 1. Score: 0 to 1000 (STRING: 400 medium, 700 high, 900 highest
        confidence).
      </p>
      <ErrorMessage error={run.error} />
      {net && c && (
        <>
          <p style={{ margin: 0 }}>
            <strong>
              {c.hits_in_collection} of {c.hits} hit genes are in this collection
            </strong>
            ; {c.hits_connected} have an interaction with another hit at score ≥ {net.provenance.min_score} (
            {c.edges} interaction{c.edges === 1 ? '' : 's'}
            {c.edges > c.edges_shown ? `, the strongest ${c.edges_shown} shown` : ''}).
          </p>
          {net.edges.length === 0 ? (
            <p className="hint">No interaction between two hits at this score: try a lower score.</p>
          ) : (
            <>
              <NetworkView net={net} />
              <p className="hint" style={{ margin: 0 }}>
                Node colour: log2 FC (blue down, red up, ±3 and beyond at full colour); grey with a dashed
                edge: a hit in several features (no single value). Thicker line: higher score.
              </p>
              <table aria-label="Interactions between hits" className="data-table">
                <thead>
                  <tr>
                    {['gene', 'log2 FC', 'gene', 'log2 FC', 'score'].map((h, i) => (
                      <th key={i} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {net.edges.map((e) => (
                    <tr key={`${e.a}|${e.b}`}>
                      <td>{e.a}</td>
                      <td>{fmt(fc.get(e.a)?.log2_fc ?? null)}</td>
                      <td>{e.b}</td>
                      <td>{fmt(fc.get(e.b)?.log2_fc ?? null)}</td>
                      <td>{e.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <ul className="hint" style={{ margin: 0 }}>
            {net.provenance.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
