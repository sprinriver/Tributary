import type { AuditList } from '@tributary/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { api, buildUrl } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { AuditTable } from './History.tsx';

export interface AuditSearch {
  action?: string | undefined;
  entity_type?: string | undefined;
  entity_id?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

const FIELDS = [
  ['action', 'Action', 'e.g. release.publish'],
  ['entity_type', 'Entity type', 'e.g. dataset_release'],
  ['entity_id', 'Entity id', 'UUID'],
] as const;

/** Dates from the form as UTC instants (start of day; `to` is exclusive, so the next day). */
function filters(s: AuditSearch) {
  const day = (d: string | undefined, plus = 0) =>
    d ? new Date(Date.parse(`${d}T00:00:00Z`) + plus * 86_400_000).toISOString() : undefined;
  return Object.fromEntries(
    Object.entries({
      action: s.action,
      entity_type: s.entity_type,
      entity_id: s.entity_id,
      from: day(s.from),
      to: day(s.to, 1),
    }).filter(([, v]) => v),
  ) as Record<string, string>;
}

/** Audit log viewer for system admins (SPEC M10): filters, paging and CSV export (the export is itself audited). */
export function AuditPage() {
  return (
    <RequireAuth>
      <Audit />
    </RequireAuth>
  );
}

function Audit() {
  const search = useSearch({ from: '/admin/audit' });
  const navigate = useNavigate({ from: '/admin/audit' });
  const [draft, setDraft] = useState<AuditSearch>(search);
  const applied = filters(search);
  const log = useInfiniteQuery({
    queryKey: ['audit', applied],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api('listAudit', { query: { ...applied, limit: 50, ...(pageParam ? { cursor: pageParam } : {}) } }),
    getNextPageParam: (last: AuditList) => last.next_cursor ?? undefined,
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <main className="stack">
      <h1>Audit log</h1>
      <p style={{ margin: 0, color: '#57606a' }}>
        Every change and export, newest first. Times are recorded by the server in UTC.
      </p>
      <form
        className="row card"
        aria-label="Audit filters"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({
            search: Object.fromEntries(Object.entries(draft).filter(([, v]) => v)) as AuditSearch,
          });
        }}
      >
        {FIELDS.map(([k, label, placeholder]) => (
          <Field key={k} label={label}>
            {(id) => (
              <input
                id={id}
                placeholder={placeholder}
                value={draft[k] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value.trim() || undefined }))}
              />
            )}
          </Field>
        ))}
        {(['from', 'to'] as const).map((k) => (
          <Field key={k} label={k === 'from' ? 'From (UTC day)' : 'To (UTC day, inclusive)'}>
            {(id) => (
              <input
                id={id}
                type="date"
                value={draft[k] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value || undefined }))}
              />
            )}
          </Field>
        ))}
        <button type="submit" className="primary">
          Apply
        </button>
        <a href={buildUrl('/v1/audit/export', {}, applied)} download>
          Export CSV
        </a>
      </form>
      <ErrorMessage error={log.error} />
      {log.data && !items.length && <p>No audit entries match these filters.</p>}
      {items.length > 0 && <AuditTable items={items} label="Audit log" showEntity />}
      {log.hasNextPage && (
        <button type="button" onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage}>
          Load more
        </button>
      )}
    </main>
  );
}
