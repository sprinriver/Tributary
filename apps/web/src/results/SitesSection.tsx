// Modification sites (Phase 47, PTM-04): the protein page's site map and table, and the results page's summary of a
// site release. The API counts; the page shows. The localisation threshold is a stated display choice.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { FigureView } from './ChartView.tsx';

const prob = (v: number | null) => (v === null ? '—' : v.toFixed(3));
const valid = (text: string) => text.trim() !== '' && Number(text) > 0 && Number(text) <= 1;

function Threshold({ value, onApply }: { value: number; onApply: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label className="stack" style={{ gap: 4 }}>
        <span>Localisation at least</span>
        <input
          type="number"
          min={0.01}
          max={1}
          step={0.01}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={!valid(draft)}
        />
        {!valid(draft) && <span className="error">A probability above 0 and at most 1.</span>}
      </label>
      <button type="button" disabled={!valid(draft)} onClick={() => onApply(Number(draft))}>
        Apply
      </button>
    </div>
  );
}

/** Protein page: the protein's sites in every readable site release. Renders nothing when there are none. */
export function ProteinSitesSection({ accession }: { accession: string }) {
  const [locMin, setLocMin] = useState(0.75);
  const sites = useQuery({
    queryKey: ['protein-sites', accession, locMin],
    queryFn: () => api('getProteinSites', { params: { id: accession }, query: { loc_min: locMin } }),
  });
  const r = sites.data;
  if (r && r.sites.length === 0) return null;
  const release = (id: string) => r?.releases.find((x) => x.release_id === id);
  return (
    <section role="region" aria-label="Modification sites" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Modification sites</h2>
      <ErrorMessage error={sites.error} />
      <Threshold value={locMin} onApply={setLocMin} />
      {r && (
        <>
          <ul style={{ margin: 0 }}>
            {r.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {r.figure && <FigureView label={`Site map of ${accession}`} figure={r.figure} />}
          <table aria-label="Sites" className="data-table">
            <thead>
              <tr>
                {[
                  'site',
                  'residue',
                  'modification',
                  'localisation',
                  'samples quantified',
                  'multiplicity',
                  'also on',
                  'experiment',
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.sites.map((s) => {
                const rel = release(s.release_id);
                return (
                  <tr key={`${s.release_id}|${s.site_id}`}>
                    <td>{s.site_id}</td>
                    <td>
                      {s.amino_acid}
                      {s.position ?? ''}
                    </td>
                    <td>{s.modification}</td>
                    <td>
                      {prob(s.localization_prob)}{' '}
                      {s.meets_threshold ? '' : <span className="hint">(below {r.loc_min})</span>}
                    </td>
                    <td>
                      {s.samples_quantified} / {s.samples_total}
                    </td>
                    <td>{s.multiplicities.join(', ') || '—'}</td>
                    <td>
                      {s.shared_with.map((id, i) => (
                        <span key={id}>
                          {i > 0 ? '; ' : ''}
                          <Link to="/proteins/$id" params={{ id }}>
                            {id}
                          </Link>
                        </span>
                      ))}
                    </td>
                    <td>
                      {rel ? (
                        <Link
                          to="/experiments/$id/results"
                          params={{ id: rel.experiment_id }}
                          search={{ version: rel.version_id }}
                        >
                          {rel.experiment_name}
                        </Link>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

/** Results page: the summary of one site release. */
export function SiteSummarySection({ release }: { release: string }) {
  const [locMin, setLocMin] = useState(0.75);
  const summary = useQuery({
    queryKey: ['site-summary', release, locMin],
    queryFn: () => api('getSiteSummary', { query: { release_id: release, loc_min: locMin } }),
  });
  const s = summary.data;
  return (
    <section role="region" aria-label="Modification sites" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Modification sites</h2>
      <ErrorMessage error={summary.error} />
      <Threshold value={locMin} onApply={setLocMin} />
      {s && (
        <>
          <p style={{ margin: 0 }}>
            <strong>
              {s.sites} {s.modification} sites
            </strong>
            , {s.meeting_threshold} with a localisation probability ≥ {s.loc_min}.
          </p>
          <ul className="hint" style={{ margin: 0 }}>
            {s.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 48 }}>
            <div className="stack" style={{ gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Sites per sample</h3>
              <table aria-label="Sites per sample" className="data-table">
                <thead>
                  <tr>
                    <th scope="col">sample</th>
                    <th scope="col">sites quantified</th>
                    <th scope="col">localised ≥ {s.loc_min} in the sample</th>
                  </tr>
                </thead>
                <tbody>
                  {s.per_sample.map((p) => (
                    <tr key={p.sample_key}>
                      <td>{p.sample_key}</td>
                      <td>{p.sites_quantified}</td>
                      <td>{p.sites_quantified_meeting_threshold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>Best-localised sites (top {s.top.length})</h3>
              <table aria-label="Best-localised sites" className="data-table">
                <thead>
                  <tr>
                    {['site', 'genes', 'localisation', 'samples quantified'].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.top.map((t) => (
                    <tr key={t.site_id}>
                      <td>
                        <Link to="/proteins/$id" params={{ id: t.protein }}>
                          {t.site_id}
                        </Link>
                      </td>
                      <td>{t.gene_names.join('; ')}</td>
                      <td>{prob(t.localization_prob)}</td>
                      <td>
                        {t.samples_quantified} / {s.per_sample.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
