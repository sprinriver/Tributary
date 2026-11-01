import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage } from '../components/ui.tsx';

export function ViewsPage() {
  return (
    <RequireAuth>
      <Views />
    </RequireAuth>
  );
}

/** Saved views (SPEC M6): yours and those shared with your programs; each opens in the Explorer. */
function Views() {
  const views = useQuery({ queryKey: ['views'], queryFn: () => api('listViews') });
  const items = views.data?.items ?? [];
  return (
    <main className="stack">
      <h1>Saved views</h1>
      <ErrorMessage error={views.error} />
      {views.isPending && <p>Loading…</p>}
      {views.data && !items.length && (
        <p style={{ color: 'var(--muted)' }}>
          No saved views yet. Save one from the <Link to="/explore">Explorer</Link>.
        </p>
      )}
      {items.length > 0 && (
        <table className="data" aria-label="Saved views">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Owner</th>
              <th scope="col">Shared with</th>
              <th scope="col">Chart</th>
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <tr key={v.id}>
                <th scope="row">
                  <Link to="/explore" search={{ view: v.id }}>
                    {v.name}
                  </Link>
                </th>
                <td>{v.owner_name ?? '—'}</td>
                <td>{v.visibility === 'private' ? 'Only you' : 'Program'}</td>
                <td>{v.chart_spec ? v.chart_spec.type : '—'}</td>
                <td>{new Date(v.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
