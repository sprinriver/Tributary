import { QcColorBySchema, type QcColorBy, type QcOverview } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { FigureView } from '../results/ChartView.tsx';

export interface QcSearch {
  program_id?: string;
  color_by?: QcColorBy;
}
type SearchPatch = { [K in keyof QcSearch]?: QcSearch[K] | undefined };

const COLOUR_LABELS: Record<QcColorBy, string> = {
  experiment: 'experiment',
  plate: 'plate',
  condition: 'condition',
  experiment_date: 'experiment date',
};
const fmt = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits));

/**
 * Cross-experiment QC (Phase 27, QCD-03): identifications per run over time, runs flagged for low IDs, and a PCA of
 * runs to spot batch effects. The API counts and apps/compute computes; this page only shows the result.
 */
export function QcPage() {
  const search = useSearch({ from: '/qc' });
  const navigate = useNavigate({ from: '/qc' });
  const colorBy = search.color_by ?? 'experiment';
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });
  const overview = useQuery({
    queryKey: ['qc-overview', search.program_id, colorBy],
    queryFn: () =>
      api('qcOverview', {
        body: {
          color_by: colorBy,
          max_experiments: 20,
          ...(search.program_id ? { program_id: search.program_id } : {}),
        },
      }),
  });
  const setSearch = (next: SearchPatch) =>
    void navigate({
      search: (prev: QcSearch) =>
        Object.fromEntries(
          Object.entries({ ...prev, ...next }).filter(([, v]) => v !== undefined && v !== ''),
        ) as QcSearch,
    });
  const data: QcOverview | undefined = overview.data;
  const flagged = data?.runs.filter((r) => r.flagged) ?? [];

  return (
    <main className="stack">
      <h1 style={{ margin: 0 }}>Cross-experiment QC</h1>
      <p className="hint" style={{ margin: 0 }}>
        The latest published protein quantities of up to 20 experiments you can read, oldest first.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span>Program</span>
          <select
            value={search.program_id ?? ''}
            onChange={(e) => setSearch({ program_id: e.target.value || undefined })}
          >
            <option value="">All programs</option>
            {programs.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span>Colour PCA by</span>
          <select
            value={colorBy}
            onChange={(e) => setSearch({ color_by: QcColorBySchema.parse(e.target.value) })}
          >
            {QcColorBySchema.options.map((c) => (
              <option key={c} value={c}>
                {COLOUR_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorMessage error={overview.error} />
      {overview.isPending && <p role="status">Reading runs…</p>}
      {data && data.runs.length === 0 && (
        <p className="hint">No published protein-quantity releases in the programs you can read yet.</p>
      )}
      {data && data.runs.length > 0 && (
        <>
          <p role="status" style={{ margin: 0 }}>
            {data.runs.length} runs in {data.experiments.length} experiments ·{' '}
            {flagged.length === 0
              ? 'no runs flagged'
              : `${flagged.length} run${flagged.length === 1 ? '' : 's'} flagged for low IDs`}
          </p>
          <section role="region" aria-label="IDs per run" className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Identifications per run</h2>
            <FigureView label="Protein groups quantified per run, oldest first" figure={data.figures.trend} />
          </section>
          <section role="region" aria-label="PCA of runs" className="stack">
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>PCA of runs</h2>
            {data.figures.pca ? (
              <FigureView
                label={`PCA of runs coloured by ${COLOUR_LABELS[colorBy]}`}
                figure={data.figures.pca}
              />
            ) : null}
            {data.provenance.pca_note && <p className="hint">{data.provenance.pca_note}</p>}
            {data.provenance.pca_features !== null && (
              <p className="hint" style={{ margin: 0 }}>
                {data.provenance.pca_features} protein groups quantified in every run shown.
              </p>
            )}
          </section>
          <table aria-label="QC per run" className="data-table">
            <thead>
              <tr>
                {[
                  'experiment',
                  'date',
                  'run',
                  'IDs',
                  '% missing',
                  'median log2 intensity',
                  'plate',
                  'condition',
                  'flag',
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={`${r.release_id}|${r.sample_key}`} className={r.flagged ? 'flagged' : undefined}>
                  <td>
                    {r.program_code} · {r.experiment_name}
                  </td>
                  <td>{r.experiment_date ?? '—'}</td>
                  <td>
                    {r.sample_key}
                    {r.instrument_run ? (
                      <>
                        <br />
                        <span className="hint">{r.instrument_run}</span>
                      </>
                    ) : null}
                  </td>
                  <td>{r.ids}</td>
                  <td>{fmt(r.missing_pct)}</td>
                  <td>{fmt(r.median_log2_intensity, 2)}</td>
                  <td>{r.factors.plate ?? '—'}</td>
                  <td>{r.factors.condition ?? '—'}</td>
                  <td>{r.flagged ? <strong>low IDs</strong> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.provenance.skipped.length > 0 && (
            <p className="hint" style={{ margin: 0 }}>
              Not read: {data.provenance.skipped.map((s) => `${s.experiment_name} (${s.reason})`).join('; ')}
            </p>
          )}
          <ul className="hint" style={{ margin: 0 }}>
            {data.provenance.transformations.map((t) => (
              <li key={t}>{t}</li>
            ))}
            {data.experiments.map((e) => (
              <li key={e.release_id}>
                {e.experiment_name}: {e.dataset_name}
                {e.importer ? ` (${e.importer})` : ''}; normalisation reported by the source:{' '}
                {e.normalisation.join('; ') || 'not reported'}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
