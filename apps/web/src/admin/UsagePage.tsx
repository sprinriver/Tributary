import { USAGE_MEASURES, type Usage } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, buildUrl } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage } from '../components/ui.tsx';
import { FigureView } from '../results/ChartView.tsx';

const LABELS: Record<(typeof USAGE_MEASURES)[number], string> = {
  active_users: 'active people',
  experiments_created: 'experiments',
  versions_published: 'versions published',
  imports: 'imports',
  releases_published: 'releases published',
  pipeline_runs: 'runs',
  exports: 'exports',
  assistant: 'assistant',
  triage: 'triage',
};
const when = (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—');

/** Usage analytics (Phase 36, USE-03): from the audit log and the registry; nothing leaves the account. */
export function UsagePage() {
  const [weeks, setWeeks] = useState(12);
  const usage = useQuery({
    queryKey: ['usage', weeks],
    queryFn: () => api('getUsage', { query: { weeks } }),
  });
  const u: Usage | undefined = usage.data;
  return (
    <RequireAuth>
      <main className="stack">
        <h1>Usage</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Counted from the audit log and the registry of this installation. Nothing is sent anywhere.
        </p>
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="stack" style={{ gap: 4 }}>
            <span>Period</span>
            <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              {[4, 12, 26, 52].map((w) => (
                <option key={w} value={w}>
                  last {w} weeks
                </option>
              ))}
            </select>
          </label>
          <a className="button" href={buildUrl('/v1/admin/usage/export', {}, { weeks })} download>
            Download CSV
          </a>
        </div>
        <ErrorMessage error={usage.error} />
        {u && (
          <>
            <section aria-label="Headline numbers" className="row" style={{ flexWrap: 'wrap' }}>
              {[
                ['People', u.totals.users],
                ['Active in 7 days', u.totals.active_7d],
                ['Active in 30 days', u.totals.active_30d],
                ['Never active', u.totals.never_active],
              ].map(([label, n]) => (
                <div key={label} className="card" style={{ minWidth: 150 }}>
                  <div className="hint">{label}</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 600 }}>{n}</div>
                </div>
              ))}
            </section>
            <section role="region" aria-label="Weekly activity" className="card stack">
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Weekly activity</h2>
              <FigureView label="Weekly activity and active people" figure={u.figure} />
              <div style={{ overflowX: 'auto' }}>
                <table aria-label="Weekly activity table" className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">week</th>
                      {USAGE_MEASURES.map((m) => (
                        <th key={m} scope="col">
                          {LABELS[m]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {u.weekly.map((w) => (
                      <tr key={w.week_start}>
                        <td>{w.week_start}</td>
                        {USAGE_MEASURES.map((m) => (
                          <td key={m}>{w[m]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section role="region" aria-label="Programs" className="card stack">
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Programs</h2>
              <table aria-label="Programs table" className="data-table">
                <thead>
                  <tr>
                    {[
                      'program',
                      'experiments',
                      'published versions',
                      'published releases',
                      'pipeline runs',
                      'last activity',
                    ].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {u.programs.map((p) => (
                    <tr key={p.program_id}>
                      <td>
                        {p.program_code} — {p.program_name}
                      </td>
                      <td>{p.experiments}</td>
                      <td>{p.published_versions}</td>
                      <td>{p.published_releases}</td>
                      <td>{p.pipeline_runs}</td>
                      <td>{when(p.last_activity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section role="region" aria-label="People" className="card stack">
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>People</h2>
              <table aria-label="People table" className="data-table">
                <thead>
                  <tr>
                    {['name', 'email', 'last sign-in', 'last active', 'actions (30 days)', 'status'].map(
                      (h) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {u.users.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.email}</td>
                      <td>{when(p.last_login_at)}</td>
                      <td>{when(p.last_active_at)}</td>
                      <td>{p.actions_30d}</td>
                      <td>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <details>
              <summary>What each number counts</summary>
              <ul className="hint">
                {Object.entries(u.definitions).map(([k, v]) => (
                  <li key={k}>
                    <strong>{k.replace(/_/g, ' ')}</strong>: {v}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </main>
    </RequireAuth>
  );
}
