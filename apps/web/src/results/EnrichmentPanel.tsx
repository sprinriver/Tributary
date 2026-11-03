import { EnrichmentBodySchema, type EnrichmentBody, type EnrichmentResponse } from '@tributary/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { FigureView } from './ChartView.tsx';

/** Rows shown in the table (the API returns every tested term). */
const TABLE_ROWS = 50;

type Draft = {
  collection_id: string;
  contrast_label: string;
  direction: 'up' | 'down' | 'both';
  adj_p_max: string;
  abs_log2fc_min: string;
  min_size: string;
  max_size: string;
  universe: 'measured' | 'annotated';
};

/**
 * Pathway enrichment of one contrast (Phase 24, ENR-04): over-representation of the contrast's hits in a gene-set
 * collection. The API picks hits and background and apps/compute runs the test; this panel only shows the result.
 */
export function EnrichmentPanel({ release, contrasts }: { release: string; contrasts: string[] }) {
  const collections = useQuery({
    queryKey: ['gene-set-collections'],
    queryFn: () => api('listGeneSetCollections'),
  });
  const [draft, setDraft] = useState<Draft>({
    collection_id: '',
    contrast_label: contrasts[0] ?? '',
    direction: 'both',
    adj_p_max: '0.05',
    abs_log2fc_min: '1',
    min_size: '10',
    max_size: '500',
    universe: 'measured',
  });
  const run = useMutation({
    mutationFn: (body: EnrichmentBody) => api('runEnrichment', { body }),
  });
  const collection = draft.collection_id || collections.data?.items[0]?.id || '';
  const parsed = EnrichmentBodySchema.safeParse({
    release_id: release,
    collection_id: collection,
    ...(contrasts.length > 1 ? { contrast_label: draft.contrast_label } : {}),
    direction: draft.direction,
    adj_p_max: Number(draft.adj_p_max),
    abs_log2fc_min: Number(draft.abs_log2fc_min),
    min_size: Number(draft.min_size),
    max_size: Number(draft.max_size),
    universe: draft.universe,
  });
  const errors = parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? ''), i.message]));
  const set = (key: keyof Draft) => (value: string) => {
    run.reset(); // a shown result always matches the controls
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const field = (key: keyof Draft, label: string, input: React.ReactNode) => (
    <label className="stack" style={{ gap: 4 }}>
      <span>{label}</span>
      {input}
      {errors[key] && <span className="error">{errors[key]}</span>}
    </label>
  );
  const number = (key: keyof Draft, label: string, step: string) =>
    field(
      key,
      label,
      <input
        type="number"
        step={step}
        value={draft[key]}
        onChange={(e) => set(key)(e.target.value)}
        style={{ width: '7rem' }}
      />,
    );

  if (collections.data && collections.data.items.length === 0) {
    return (
      <section role="region" aria-label="Pathway enrichment" className="stack">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Pathway enrichment</h2>
        <p className="hint">
          No gene-set collections yet: a system administrator imports GO or Reactome (GMT).
        </p>
      </section>
    );
  }
  const result: EnrichmentResponse | undefined = run.data;
  return (
    <section role="region" aria-label="Pathway enrichment" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Pathway enrichment</h2>
      <ErrorMessage error={collections.error} />
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {field(
          'collection_id',
          'Gene sets',
          <select value={collection} onChange={(e) => set('collection_id')(e.target.value)}>
            {collections.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.source} {c.source_release}
              </option>
            ))}
          </select>,
        )}
        {contrasts.length > 1 &&
          field(
            'contrast_label',
            'Contrast',
            <select value={draft.contrast_label} onChange={(e) => set('contrast_label')(e.target.value)}>
              {contrasts.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>,
          )}
        {field(
          'direction',
          'Direction',
          <select value={draft.direction} onChange={(e) => set('direction')(e.target.value)}>
            <option value="both">up and down</option>
            <option value="up">up</option>
            <option value="down">down</option>
          </select>,
        )}
        {number('adj_p_max', 'Adjusted p at most', '0.01')}
        {number('abs_log2fc_min', '|log2 FC| at least', '0.1')}
        {number('min_size', 'Minimum set size', '1')}
        {number('max_size', 'Maximum set size', '1')}
        {field(
          'universe',
          'Universe',
          <select value={draft.universe} onChange={(e) => set('universe')(e.target.value)}>
            <option value="measured">every tested identifier</option>
            <option value="annotated">tested and in a gene set</option>
          </select>,
        )}
        <button
          type="button"
          className="primary"
          disabled={!parsed.success || run.isPending}
          onClick={() => parsed.success && run.mutate(parsed.data)}
        >
          Run enrichment
        </button>
      </div>
      <ErrorMessage error={run.error} />
      {run.isPending && <p role="status">Testing gene sets…</p>}
      {result && (
        <>
          <FigureView
            label={`Enrichment dot plot — ${result.provenance.contrast_label}`}
            figure={result.figure}
          />
          <table aria-label="Enrichment results" className="data-table">
            <thead>
              <tr>
                {['gene set', 'hits / size', 'fold enrichment', 'p', 'adjusted p', 'hits in set'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.terms.slice(0, TABLE_ROWS).map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name}
                    <br />
                    <span className="hint">{t.id}</span>
                  </td>
                  <td>
                    {t.overlap} / {t.size}
                  </td>
                  <td>{t.fold_enrichment.toPrecision(3)}</td>
                  <td>{t.p_value.toExponential(2)}</td>
                  <td>{t.adj_p_value.toExponential(2)}</td>
                  <td>{t.genes.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ margin: 0 }}>
            {result.provenance.hits} hits of {result.provenance.background} tested (
            {result.provenance.hit_features} of {result.provenance.features} features) ·{' '}
            {result.provenance.tested} sets tested,{' '}
            {result.provenance.excluded_small + result.provenance.excluded_large} outside the size limits ·{' '}
            {result.provenance.method}, {result.provenance.adj_method} · {result.provenance.collection.source}{' '}
            {result.provenance.collection.source_release}
            {result.terms.length > TABLE_ROWS &&
              ` · first ${TABLE_ROWS} of ${result.terms.length} terms shown`}
          </p>
          <ul className="hint" style={{ margin: 0 }}>
            {result.provenance.transformations.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
