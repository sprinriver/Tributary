import type { AuditEntry } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';

type HistoryType = 'experiment' | 'experiment_version' | 'dataset_release' | 'file' | 'pipeline_run';

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Audit rows as a table (actor, action, entity, reason); shared by the history tab and the admin audit page. */
export function AuditTable({
  items,
  label,
  showEntity,
}: {
  items: AuditEntry[];
  label: string;
  showEntity?: boolean;
}) {
  return (
    <table className="data" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">When</th>
          <th scope="col">Who</th>
          <th scope="col">Action</th>
          {showEntity && <th scope="col">Entity</th>}
          <th scope="col">Reason</th>
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.id}>
            <td>
              <time dateTime={r.at}>{when(r.at)}</time>
            </td>
            <td>
              {r.actor_name ?? r.actor_id}
              {r.actor_type !== 'user' && <small> ({r.actor_type})</small>}
            </td>
            <td>
              <code>{r.action}</code>
            </td>
            {showEntity && (
              <td>
                {r.entity_type} <small style={{ color: 'var(--muted)' }}>{r.entity_id}</small>
              </td>
            )}
            <td>{r.reason ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Per-entity history (SPEC M10): who changed what, when and why. */
export function History({ type, id }: { type: HistoryType; id: string }) {
  const history = useQuery({
    queryKey: ['history', type, id],
    queryFn: () => api('getHistory', { params: { type, id } }),
  });
  return (
    <section role="region" aria-label="History" className="stack">
      <h2>History</h2>
      <ErrorMessage error={history.error} />
      {history.data && !history.data.items.length && <p>No recorded changes.</p>}
      {history.data && history.data.items.length > 0 && (
        <AuditTable items={history.data.items} label="History of changes" />
      )}
    </section>
  );
}
