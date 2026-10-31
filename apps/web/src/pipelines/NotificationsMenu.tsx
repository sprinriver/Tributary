import type { MyRun } from '@tributary/contracts';
import { StatusBadge } from '@tributary/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { POPOVER_STYLE, usePopover } from '../components/popover.ts';
import { isActive, RUN_LABEL, RUN_TONE } from './labels.ts';

const SEEN_KEY = 'tributary.runs.seen';

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

/** A run is news when it finished after the user last opened this menu. */
const isNews = (run: MyRun, seen: string) =>
  !isActive(run.status) && !!run.finished_at && run.finished_at > seen;

/** In-app notifications (SPEC M4): my runs of the last 7 days; finished ones I have not seen are counted. */
export function NotificationsMenu() {
  const { open, setOpen, ref } = usePopover();
  const [seen, setSeen] = useState(readSeen);
  const runs = useQuery({
    queryKey: ['my-runs'],
    queryFn: () => api('listMyRuns'),
    refetchInterval: 10_000,
  });
  const items = runs.data?.items ?? [];
  const unread = items.filter((r) => isNews(r, seen)).length;

  const toggle = () => {
    if (open) {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(SEEN_KEY, now);
      } catch {
        // Private windows: the count resets on reload.
      }
      setSeen(now);
    }
    setOpen(!open);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={toggle}>
        Runs{unread > 0 && <strong aria-label={`${unread} new`}> · {unread} new</strong>}
      </button>
      {open && (
        <div role="region" aria-label="Run notifications" style={{ ...POPOVER_STYLE, minWidth: 320 }}>
          {!items.length && <p style={{ margin: 0 }}>No runs in the last 7 days.</p>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
            {items.map((r) => (
              <li key={r.id} style={{ fontWeight: isNews(r, seen) ? 600 : 400 }}>
                <Link to="/runs/$id" params={{ id: r.id }} onClick={() => setOpen(false)}>
                  {r.pipeline_name} on {r.experiment_name}
                </Link>{' '}
                <StatusBadge label={RUN_LABEL[r.status]} tone={RUN_TONE[r.status]} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
