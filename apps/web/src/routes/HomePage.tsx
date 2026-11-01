import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '@tributary/ui';
import { api } from '../api.ts';
import { loginHref, useMe } from '../auth.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
import { describeHealth, fetchApiHealth } from '../health.ts';
import { RUN_LABEL, RUN_TONE } from '../pipelines/labels.ts';

const AREAS: { title: string; text: string; to: string; action: string; icon: IconName }[] = [
  {
    title: 'Registry',
    text: 'Register studies, edit manifests against templates and ontologies, publish immutable versions.',
    to: '/experiments',
    action: 'Open registry',
    icon: 'flask',
  },
  {
    title: 'Data catalog',
    text: 'Versioned dataset releases with contracts, quality rules, lineage and history.',
    to: '/datasets',
    action: 'Open catalog',
    icon: 'database',
  },
  {
    title: 'Explore and chart',
    text: 'Filter, join and chart releases; save views; copy the query as Python or R.',
    to: '/explore',
    action: 'Open explorer',
    icon: 'table',
  },
  {
    title: 'Compare contrasts',
    text: 'Fold changes across 2–6 contrasts with overlap tables and intersection bars.',
    to: '/compare',
    action: 'Open comparison',
    icon: 'compare',
  },
];

export function HomePage() {
  const health = useQuery({ queryKey: ['api-health'], queryFn: () => fetchApiHealth(), retry: 1 });
  const { label, tone } = describeHealth(
    health.isPending
      ? { state: 'pending' }
      : health.isError
        ? { state: 'error' }
        : { state: 'success', health: health.data },
  );
  const me = useMe();
  const runs = useQuery({
    queryKey: ['my-runs'],
    queryFn: () => api('listMyRuns'),
    enabled: !!me.data,
  });
  const first = me.data?.user.name.split(' ')[0];

  return (
    <main className="stack fade-in">
      <section
        className="card"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          padding: '22px 24px',
        }}
      >
        <div>
          <h1>Tributary</h1>
          <p style={{ margin: 0, color: 'var(--text-2)' }}>
            {first ? `Welcome back, ${first}. ` : ''}Experiment data platform for drug discovery — from raw
            files to results you can trust.
          </p>
        </div>
        <div aria-label="Service health" role="group">
          <StatusBadge label={label} tone={tone} />
        </div>
      </section>

      {me.data ? (
        <>
          <div
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}
          >
            {AREAS.map((a) => (
              <section key={a.to} className="card stack" style={{ gap: 10 }} aria-label={a.title}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: 'var(--brand-50)',
                    color: 'var(--brand-600)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={a.icon} />
                </div>
                <h2 style={{ margin: 0 }}>{a.title}</h2>
                <p style={{ margin: 0, color: 'var(--muted)', flex: 1 }}>{a.text}</p>
                <Link to={a.to} className="button" style={{ alignSelf: 'flex-start' }}>
                  {a.action} →
                </Link>
              </section>
            ))}
          </div>
          <section className="card stack" aria-label="Recent runs">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 style={{ margin: 0 }}>Your pipeline runs (last 7 days)</h2>
              <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>
                Press <kbd>⌘K</kbd> to search anything
              </span>
            </div>
            {runs.data && !runs.data.items.length && (
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                No runs yet. Launch one from an experiment's Files tab.
              </p>
            )}
            {runs.data && runs.data.items.length > 0 && (
              <table className="data" aria-label="Recent runs">
                <thead>
                  <tr>
                    <th scope="col">Pipeline</th>
                    <th scope="col">Experiment</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.data.items.slice(0, 6).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to="/runs/$id" params={{ id: r.id }}>
                          {r.pipeline_name}
                        </Link>
                      </td>
                      <td>{r.experiment_name}</td>
                      <td>
                        <StatusBadge label={RUN_LABEL[r.status]} tone={RUN_TONE[r.status]} live={false} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : (
        !me.isPending && (
          <section className="card stack" aria-label="Get started" style={{ alignItems: 'flex-start' }}>
            <h2 style={{ margin: 0 }}>Get started</h2>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Sign in with your organisation account to see your programs, experiments and results.
            </p>
            <a className="button primary" href={loginHref('/')}>
              Continue with SSO
            </a>
          </section>
        )
      )}
    </main>
  );
}
