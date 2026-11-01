import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@tributary/ui';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage } from '../components/ui.tsx';

const TONE = { ok: 'ok', degraded: 'warning', down: 'error' } as const;
const LABEL = { ok: 'OK', degraded: 'Degraded', down: 'Down' } as const;

export function HealthPage() {
  return (
    <RequireAuth>
      <Health />
    </RequireAuth>
  );
}

/** System health (SPEC M11): dependencies, pipeline runners and AI settings. */
function Health() {
  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api('getSystemHealth'),
    refetchInterval: 30_000,
  });
  const h = health.data;
  return (
    <main className="stack">
      <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>System health</h1>
        <button type="button" onClick={() => void health.refetch()} disabled={health.isFetching}>
          {health.isFetching ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <ErrorMessage error={health.error} />
      {h && (
        <>
          <p style={{ margin: 0 }}>
            Overall: <StatusBadge label={LABEL[h.status]} tone={TONE[h.status]} live={false} />{' '}
            <span style={{ color: 'var(--muted)' }}>
              checked {new Date(h.checked_at).toLocaleTimeString()}
            </span>
          </p>
          <table className="data" aria-label="Health checks">
            <thead>
              <tr>
                <th scope="col">Dependency</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
                <th scope="col">Latency</th>
              </tr>
            </thead>
            <tbody>
              {h.checks.map((c) => (
                <tr key={c.name}>
                  <th scope="row">{c.label}</th>
                  <td>
                    <StatusBadge label={LABEL[c.status]} tone={TONE[c.status]} live={false} />
                  </td>
                  <td>{c.detail}</td>
                  <td>{c.latency_ms === null ? '—' : `${c.latency_ms} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <section className="card stack" aria-label="Runners">
            <h2 style={{ margin: 0 }}>Pipeline runners</h2>
            <table className="data" aria-label="Pipeline runners">
              <thead>
                <tr>
                  <th scope="col">Runner</th>
                  <th scope="col">Configured</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {h.runners.map((r) => (
                  <tr key={r.kind}>
                    <th scope="row">{r.kind}</th>
                    <td>{r.configured ? 'Yes' : 'No'}</td>
                    <td>{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              Runner credentials and queues are set in the deployment (environment and Terraform), not here.
            </p>
          </section>
          <section className="card stack" aria-label="AI assistant">
            <h2 style={{ margin: 0 }}>AI assistant</h2>
            <p style={{ margin: 0 }}>
              {h.ai.enabled ? `On (${h.ai.provider})` : 'Off'} — the provider, enabled features and monthly
              budget are configured here once the assistant is available.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
