import { DATASET_KINDS } from '@tributary/contracts';
import { StatusBadge } from '@tributary/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { RELEASE_TONE, releaseLabel } from './labels.ts';

export interface DatasetsSearch {
  kind?: string | undefined;
  q?: string | undefined;
}

export function DatasetsPage() {
  return (
    <RequireAuth>
      <Catalog />
    </RequireAuth>
  );
}

function Catalog() {
  const search = useSearch({ from: '/datasets' });
  const navigate = useNavigate({ from: '/datasets' });
  const datasets = useQuery({
    queryKey: ['datasets', search],
    queryFn: () =>
      api('listDatasets', {
        query: {
          ...(search.kind ? { kind: search.kind as never } : {}),
          ...(search.q ? { q: search.q } : {}),
        },
      }),
  });
  const set = (patch: DatasetsSearch) => void navigate({ search: { ...search, ...patch } });
  return (
    <main className="stack">
      <h1>Datasets</h1>
      <div className="row">
        <Field label="Kind">
          {(id) => (
            <select
              id={id}
              value={search.kind ?? ''}
              onChange={(e) => set({ kind: e.target.value || undefined })}
            >
              <option value="">All kinds</option>
              {DATASET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Search">
          {(id) => (
            <input
              id={id}
              type="search"
              defaultValue={search.q ?? ''}
              onKeyDown={(e) => e.key === 'Enter' && set({ q: e.currentTarget.value || undefined })}
            />
          )}
        </Field>
      </div>
      <ErrorMessage error={datasets.error} />
      <table className="data" aria-label="Datasets">
        <thead>
          <tr>
            <th scope="col">Dataset</th>
            <th scope="col">Kind</th>
            <th scope="col">Program</th>
            <th scope="col">Experiment</th>
            <th scope="col">Latest release</th>
            <th scope="col">Rows</th>
            <th scope="col">Releases</th>
          </tr>
        </thead>
        <tbody>
          {datasets.data?.items.map((d) => (
            <tr key={d.id}>
              <th scope="row">
                {d.latest_release ? (
                  <Link to="/releases/$id" params={{ id: d.latest_release.id }}>
                    {d.name}
                  </Link>
                ) : (
                  d.name
                )}
              </th>
              <td>{d.kind}</td>
              <td>{d.program_code}</td>
              <td>
                {d.experiment_id ? (
                  <Link to="/experiments/$id" params={{ id: d.experiment_id }}>
                    {d.experiment_name} v{d.version_number}
                  </Link>
                ) : (
                  'Reference data'
                )}
              </td>
              <td>
                {d.latest_release ? (
                  <>
                    #{d.latest_release.release_number}{' '}
                    <StatusBadge
                      label={releaseLabel(d.latest_release.status)}
                      tone={RELEASE_TONE[d.latest_release.status] ?? 'pending'}
                      live={false}
                    />
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>{d.latest_release?.row_count.toLocaleString() ?? '—'}</td>
              <td>{d.release_count}</td>
            </tr>
          ))}
          {datasets.data && !datasets.data.items.length && (
            <tr>
              <td colSpan={7}>No datasets yet. Import a file from an experiment's Files tab.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
