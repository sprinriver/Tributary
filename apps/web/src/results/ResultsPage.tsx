import type { ChartSpec, VersionResults } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { ChartView, LAYOUT } from './ChartView.tsx';
import { DoseResponseViewer } from './DoseResponseViewer.tsx';

const firstAccession = (v: unknown) =>
  Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '').split(';')[0]!;

function Methods({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <section role="region" aria-label="Methods" className="card stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Methods</h2>
      <p style={{ margin: 0 }}>{text}</p>
      <div className="row">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
        >
          Copy methods
        </button>
        {copied && <span role="status">Copied</span>}
      </div>
    </section>
  );
}

function TopHits({ release }: { release: string }) {
  const hits = useQuery({
    queryKey: ['top-hits', release],
    queryFn: () =>
      api('runQuery', {
        body: {
          source: { releaseIds: [release] },
          where: { combinator: 'and', rules: [{ field: 'adj_p_value', operator: 'notNull' }] },
          select: ['feature_id', 'gene_names', 'contrast_label', 'log2_fc', 'adj_p_value'],
          orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
          page: { size: 25 },
        },
      }),
  });
  return (
    <section className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Top hits</h2>
      <ErrorMessage error={hits.error} />
      <table aria-label="Top hits" className="data-table">
        <thead>
          <tr>
            {['feature', 'genes', 'contrast', 'log2 FC', 'adjusted p'].map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hits.data?.rows.map((r, i) => (
            <tr key={i}>
              <td>
                <Link to="/proteins/$id" params={{ id: firstAccession(r.feature_id) }}>
                  {String(r.feature_id)}
                </Link>
              </td>
              <td>{Array.isArray(r.gene_names) ? r.gene_names.join('; ') : ''}</td>
              <td>{String(r.contrast_label)}</td>
              <td>{Number(r.log2_fc).toPrecision(3)}</td>
              <td>{Number(r.adj_p_value).toExponential(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const volcano = (release: string, contrastId: string): ChartSpec =>
  ({
    type: 'volcano',
    data: {
      source: { releaseIds: [release] },
      where: { combinator: 'and', rules: [{ field: 'contrast_id', operator: '=', value: contrastId }] },
    },
    encodings: { x: 'log2_fc', y: 'adj_p_value', label: 'feature_id' },
    options: { label_top: 10 },
    layout: LAYOUT,
  }) as ChartSpec;

function Results({ r }: { r: VersionResults }) {
  const of = (kind: string) => r.releases.filter((x) => x.kind === kind);
  const pq = of('protein_quant')[0];
  const da = of('differential_abundance');
  const dr = of('dose_response');
  return (
    <div className="stack">
      <Methods text={r.methods} />
      {pq && (
        <section role="region" aria-label="QC" className="stack">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>QC</h2>
          <ChartView
            spec={
              {
                type: 'qc_panel',
                data: { source: { releaseIds: [pq.id] } },
                encodings: { x: 'sample_key', rowLabel: 'protein_group', values: 'intensity' },
                options: {},
                layout: LAYOUT,
              } as ChartSpec
            }
          />
        </section>
      )}
      {da.length > 0 &&
        r.contrasts.map((c) => (
          <section key={c.id} role="region" aria-label={`Volcano — ${c.label}`} className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Volcano — {c.label}</h2>
            <ChartView spec={volcano(da[0]!.id, c.id)} />
          </section>
        ))}
      {da[0] && <TopHits release={da[0].id} />}
      {dr.length > 0 && (
        <section role="region" aria-label="Dose-response" className="stack">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Dose-response</h2>
          <DoseResponseViewer source={{ releaseIds: [dr[0]!.id] }} />
        </section>
      )}
      <section role="region" aria-label="Files" className="stack">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Files</h2>
        <ul>
          {r.files.map((f) => (
            <li key={f.id}>
              {f.name}{' '}
              <span className="hint">
                ({f.role}, {f.ingest_status})
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** SPEC M8 experiment results page: generated from the version's published releases and run provenance. */
export function ResultsPage() {
  const { id } = useParams({ from: '/experiments/$id/results' });
  const search = useSearch({ from: '/experiments/$id/results' });
  const experiment = useQuery({
    queryKey: ['experiment', id],
    queryFn: () => api('getExperiment', { params: { id } }),
  });
  const versions = experiment.data?.versions ?? [];
  const version = search.version ?? versions.find((v) => v.is_latest_published)?.id ?? versions.at(-1)?.id;
  const results = useQuery({
    queryKey: ['results', version],
    queryFn: () => api('getVersionResults', { params: { id: version! } }),
    enabled: !!version,
  });
  return (
    <main style={{ padding: 24 }} className="stack">
      <p style={{ margin: 0 }}>
        <Link to="/experiments/$id" params={{ id }}>
          ← Experiment
        </Link>
      </p>
      <h1 style={{ margin: 0 }}>
        Results — {experiment.data?.name ?? '…'}
        {results.data ? ` v${results.data.version_number}` : ''}
      </h1>
      <ErrorMessage error={experiment.error ?? results.error} />
      {results.data && <Results r={results.data} />}
    </main>
  );
}
