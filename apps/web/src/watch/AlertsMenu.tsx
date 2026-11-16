import type { Alert } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '../api.ts';
import { POPOVER_STYLE, usePopover } from '../components/popover.ts';

/** Alerts (Phase 26, WAT-03): newly published releases with a hit for something I watch. */
export function AlertsMenu() {
  const { open, setOpen, ref } = usePopover();
  const client = useQueryClient();
  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api('listAlerts'),
    refetchInterval: 15_000,
  });
  const done = () => client.invalidateQueries({ queryKey: ['alerts'] });
  const readAll = useMutation({ mutationFn: () => api('readAllAlerts'), onSuccess: done });
  const read = useMutation({
    mutationFn: (id: string) => api('readAlert', { params: { id } }),
    onSuccess: done,
  });
  const unread = alerts.data?.unread ?? 0;
  const items = alerts.data?.items ?? [];
  const values = (a: Alert) =>
    a.log2_fc === null
      ? ''
      : ` · log2 FC ${a.log2_fc.toPrecision(3)}, adjusted p ${a.adj_p_value?.toExponential(2) ?? '—'}`;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        Alerts{unread > 0 && <strong aria-label={`${unread} new`}> · {unread} new</strong>}
      </button>
      {open && (
        <div role="region" aria-label="Alerts" style={{ ...POPOVER_STYLE, minWidth: 360, maxWidth: 480 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Alerts</strong>
            <button
              type="button"
              disabled={unread === 0 || readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              Mark all read
            </button>
          </div>
          {!items.length && (
            <p className="hint" style={{ margin: 0 }}>
              No alerts. Watch a protein or compound from its page to hear about new hits.
            </p>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
            {items.map((a) => (
              <li key={a.id} style={{ fontWeight: a.read_at ? 400 : 600 }}>
                {a.watch.key}
                {a.watch.label ? ` (${a.watch.label})` : ''} in{' '}
                {a.experiment_id ? (
                  <Link
                    to="/experiments/$id/results"
                    params={{ id: a.experiment_id }}
                    onClick={() => {
                      if (!a.read_at) read.mutate(a.id);
                      setOpen(false);
                    }}
                  >
                    {a.experiment_name ?? a.dataset_name}
                  </Link>
                ) : (
                  <Link to="/releases/$id" params={{ id: a.release_id }} onClick={() => setOpen(false)}>
                    {a.dataset_name}
                  </Link>
                )}{' '}
                <span className="hint">
                  [{a.program_code}]{a.contrast_label ? ` ${a.contrast_label}` : ''}
                  {values(a)} — {a.rule}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
