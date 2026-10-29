import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { AssayTypeKey, ExperimentListItem } from '@tributary/contracts';
import { useState } from 'react';
import { RequireAuth } from '../components/Layout.tsx';
import { ASSAY_LABELS, ErrorMessage, Field, VersionStatus } from '../components/ui.tsx';
import { useCloneVersion, useExperiments, usePrograms } from '../registry/queries.ts';

/** List filters kept in the URL, so a filtered list can be shared. */
export interface ExperimentsSearch {
  name?: string | undefined;
  q?: string | undefined;
  assay_type?: AssayTypeKey | undefined;
  program_id?: string | undefined;
  date_from?: string | undefined;
  date_to?: string | undefined;
  include_archived?: 'true' | undefined;
  sort?: 'name' | 'created_at' | 'updated_at' | 'experiment_date' | undefined;
  dir?: 'asc' | 'desc' | undefined;
}

const COLUMNS = [
  { id: 'name', label: 'Name', sort: 'name' },
  { id: 'version', label: 'Version' },
  { id: 'status', label: 'Status' },
  { id: 'program', label: 'Program' },
  { id: 'assay', label: 'Assay type' },
  { id: 'date', label: 'Experiment date', sort: 'experiment_date' },
  { id: 'latest', label: 'Latest published' },
  { id: 'urn', label: 'URN' },
  { id: 'created', label: 'Created', sort: 'created_at' },
] as const;
type ColumnId = (typeof COLUMNS)[number]['id'];
const DEFAULT_COLUMNS: ColumnId[] = ['name', 'version', 'status', 'program', 'assay', 'date', 'latest'];

function cell(id: ColumnId, e: ExperimentListItem) {
  switch (id) {
    case 'name':
      return (
        <Link to="/experiments/$id" params={{ id: e.id }}>
          {e.name}
        </Link>
      );
    case 'version':
      return `v${e.current_version.version_number}`;
    case 'status':
      return <VersionStatus status={e.current_version.status} live={false} />;
    case 'program':
      return e.program_code;
    case 'assay':
      return ASSAY_LABELS[e.assay_type] ?? e.assay_type;
    case 'date':
      return e.current_version.experiment_date ?? '—';
    case 'latest':
      return e.latest_published_version ? `v${e.latest_published_version}` : '—';
    case 'urn':
      return <code>{e.urn}</code>;
    case 'created':
      return new Date(e.created_at).toLocaleDateString();
  }
}

export function ExperimentsPage() {
  return (
    <RequireAuth>
      <ExperimentsList />
    </RequireAuth>
  );
}

function ExperimentsList() {
  const search = useSearch({ from: '/experiments' });
  const navigate = useNavigate({ from: '/experiments' });
  const [cursors, setCursors] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnId[]>(DEFAULT_COLUMNS);
  const programs = usePrograms();
  const list = useExperiments({
    ...search,
    limit: 25,
    ...(cursors.length ? { cursor: cursors.at(-1)! } : {}),
  });
  const clone = useCloneVersion();

  const setFilter = (patch: Partial<ExperimentsSearch>) => {
    setCursors([]);
    void navigate({
      search: (prev) =>
        Object.fromEntries(Object.entries({ ...prev, ...patch }).filter(([, v]) => v)) as ExperimentsSearch,
    });
  };
  const toggleSort = (sort: ExperimentsSearch['sort']) =>
    setFilter({ sort, dir: search.sort === sort && search.dir !== 'desc' ? 'desc' : 'asc' });

  return (
    <main>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Experiments</h1>
        <Link to="/experiments/new" className="button primary">
          New experiment
        </Link>
      </div>

      <form
        className="row"
        role="search"
        aria-label="Filter experiments"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="Name contains">
          {(id) => (
            <input id={id} value={search.name ?? ''} onChange={(e) => setFilter({ name: e.target.value })} />
          )}
        </Field>
        <Field label="Search searchable fields">
          {(id) => (
            <input
              id={id}
              type="search"
              value={search.q ?? ''}
              onChange={(e) => setFilter({ q: e.target.value })}
            />
          )}
        </Field>
        <Field label="Assay type">
          {(id) => (
            <select
              id={id}
              value={search.assay_type ?? ''}
              onChange={(e) =>
                setFilter({ assay_type: (e.target.value || undefined) as AssayTypeKey | undefined })
              }
            >
              <option value="">Any</option>
              {Object.entries(ASSAY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Program">
          {(id) => (
            <select
              id={id}
              value={search.program_id ?? ''}
              onChange={(e) => setFilter({ program_id: e.target.value })}
            >
              <option value="">Any</option>
              {programs.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Date from">
          {(id) => (
            <input
              id={id}
              type="date"
              value={search.date_from ?? ''}
              onChange={(e) => setFilter({ date_from: e.target.value })}
            />
          )}
        </Field>
        <Field label="Date to">
          {(id) => (
            <input
              id={id}
              type="date"
              value={search.date_to ?? ''}
              onChange={(e) => setFilter({ date_to: e.target.value })}
            />
          )}
        </Field>
        <label className="row" style={{ gap: 4 }}>
          <input
            type="checkbox"
            checked={search.include_archived === 'true'}
            onChange={(e) => setFilter({ include_archived: e.target.checked ? 'true' : undefined })}
          />
          Show archived
        </label>
        <details>
          <summary>Columns</summary>
          <fieldset>
            <legend>Visible columns</legend>
            {COLUMNS.map((c) => (
              <label key={c.id} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={columns.includes(c.id)}
                  onChange={(e) =>
                    setColumns((cur) =>
                      e.target.checked
                        ? COLUMNS.map((x) => x.id).filter((x) => x === c.id || cur.includes(x))
                        : cur.filter((x) => x !== c.id),
                    )
                  }
                />{' '}
                {c.label}
              </label>
            ))}
          </fieldset>
        </details>
      </form>

      <ErrorMessage error={list.error ?? clone.error} />
      <table className="data" aria-label="Experiments">
        <thead>
          <tr>
            {COLUMNS.filter((c) => columns.includes(c.id)).map((c) => (
              <th
                key={c.id}
                scope="col"
                aria-sort={
                  'sort' in c && search.sort === c.sort
                    ? search.dir === 'desc'
                      ? 'descending'
                      : 'ascending'
                    : undefined
                }
              >
                {'sort' in c ? (
                  <button type="button" onClick={() => toggleSort(c.sort)}>
                    {c.label}
                    {search.sort === c.sort ? (search.dir === 'desc' ? ' ▼' : ' ▲') : ''}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((e) => (
            <tr key={e.id}>
              {COLUMNS.filter((c) => columns.includes(c.id)).map((c) => (
                <td key={c.id}>{cell(c.id, e)}</td>
              ))}
              <td>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" disabled title="Pipelines arrive in a later release">
                    Launch pipeline
                  </button>
                  <button
                    type="button"
                    disabled={clone.isPending}
                    onClick={() =>
                      clone.mutate(e.current_version.id, {
                        onSuccess: (v) =>
                          void navigate({
                            to: '/experiments/$id',
                            params: { id: e.id },
                            search: { version: v.id },
                          }),
                      })
                    }
                  >
                    Create version
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data && !list.data.items.length && <p className="muted">No experiments match these filters.</p>}
      <div className="toolbar">
        <button type="button" disabled={!cursors.length} onClick={() => setCursors((c) => c.slice(0, -1))}>
          Previous
        </button>
        <button
          type="button"
          disabled={!list.data?.next_cursor}
          onClick={() => list.data?.next_cursor && setCursors((c) => [...c, list.data.next_cursor!])}
        >
          Next
        </button>
      </div>
    </main>
  );
}
