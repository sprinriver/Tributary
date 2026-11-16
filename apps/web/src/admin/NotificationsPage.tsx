import {
  CreateNotificationRouteBodySchema,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
  type NotificationRoute,
} from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage, Field } from '../components/ui.tsx';

const EVENT_LABELS: Record<NotificationEvent, string> = {
  'run.finished': 'Pipeline run finished',
  'version.published': 'Experiment version published',
  'release.published': 'Dataset release published',
  'triage.decision': 'Triage decision',
};

/**
 * Team notifications (Phase 31, NOTIF-04): Slack and Teams channels for chosen events. The webhook URL is shown
 * only while it is typed; afterwards the API returns its host only.
 */
export function NotificationsPage() {
  const client = useQueryClient();
  const routes = useQuery({
    queryKey: ['notification-routes'],
    queryFn: () => api('listNotificationRoutes'),
  });
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });
  const [draft, setDraft] = useState({
    name: '',
    kind: 'slack' as 'slack' | 'teams',
    url: '',
    program_id: '',
    events: ['release.published', 'run.finished'] as NotificationEvent[],
  });
  const parsed = CreateNotificationRouteBodySchema.safeParse({
    name: draft.name,
    kind: draft.kind,
    url: draft.url,
    events: draft.events,
    ...(draft.program_id ? { program_id: draft.program_id } : {}),
  });
  const errors = parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? ''), i.message]));
  const refresh = () => client.invalidateQueries({ queryKey: ['notification-routes'] });
  const create = useMutation({
    mutationFn: () =>
      api('createNotificationRoute', { body: parsed.data!, reason: 'Add notification route' }),
    onSuccess: async () => {
      setDraft((d) => ({ ...d, name: '', url: '' }));
      await refresh();
    },
  });
  const toggle = (event: NotificationEvent) =>
    setDraft((d) => ({
      ...d,
      events: d.events.includes(event) ? d.events.filter((e) => e !== event) : [...d.events, event],
    }));

  return (
    <RequireAuth>
      <main className="stack">
        <h1>Team notifications</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Post events to Slack or Microsoft Teams channels. Messages contain names, statuses and a link, never
          data values, but they do leave your account: choose channels accordingly.
        </p>
        <section className="card stack" aria-label="Add a channel">
          <h2 style={{ margin: 0 }}>Add a channel</h2>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Field label="Name" error={draft.name ? errors.name : undefined}>
              {(id) => (
                <input
                  id={id}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Service">
              {(id) => (
                <select
                  id={id}
                  value={draft.kind}
                  onChange={(e) =>
                    setDraft({ ...draft, kind: e.target.value === 'teams' ? 'teams' : 'slack' })
                  }
                >
                  <option value="slack">Slack</option>
                  <option value="teams">Microsoft Teams</option>
                </select>
              )}
            </Field>
            <Field
              label="Incoming webhook URL"
              hint={
                draft.kind === 'slack'
                  ? 'https://hooks.slack.com/services/…'
                  : 'A Teams channel webhook or Workflows URL'
              }
              error={draft.url ? errors.url : undefined}
            >
              {(id) => (
                <input
                  id={id}
                  type="password"
                  autoComplete="off"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value.trim() })}
                  style={{ minWidth: '22rem' }}
                />
              )}
            </Field>
            <Field label="Programs">
              {(id) => (
                <select
                  id={id}
                  value={draft.program_id}
                  onChange={(e) => setDraft({ ...draft, program_id: e.target.value })}
                >
                  <option value="">All programs</option>
                  {programs.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <fieldset className="row" style={{ flexWrap: 'wrap', border: 0, padding: 0, margin: 0 }}>
            <legend className="hint">Events</legend>
            {NOTIFICATION_EVENTS.map((e) => (
              <label key={e} className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={draft.events.includes(e)} onChange={() => toggle(e)} />
                {EVENT_LABELS[e]}
              </label>
            ))}
          </fieldset>
          {errors.events && <span className="error">Choose at least one event.</span>}
          <div>
            <button
              type="button"
              className="primary"
              disabled={!parsed.success || create.isPending}
              onClick={() => create.mutate()}
            >
              Add channel
            </button>
          </div>
          <ErrorMessage error={create.error} />
        </section>
        <ErrorMessage error={routes.error} />
        {routes.data && routes.data.items.length === 0 && <p className="hint">No channels yet.</p>}
        {routes.data?.items.map((r) => (
          <RouteCard key={r.id} route={r} onChange={refresh} />
        ))}
      </main>
    </RequireAuth>
  );
}

function RouteCard({ route, onChange }: { route: NotificationRoute; onChange: () => Promise<void> }) {
  const deliveries = useQuery({
    queryKey: ['notification-deliveries', route.id],
    queryFn: () => api('listNotificationDeliveries', { params: { id: route.id } }),
  });
  const after = async () => {
    await onChange();
    await deliveries.refetch();
  };
  const test = useMutation({
    mutationFn: () => api('testNotificationRoute', { params: { id: route.id } }),
    onSuccess: after,
  });
  const pause = useMutation({
    mutationFn: () =>
      api('updateNotificationRoute', {
        params: { id: route.id },
        body: { active: !route.active },
        reason: route.active ? 'Pause channel' : 'Resume channel',
      }),
    onSuccess: after,
  });
  const remove = useMutation({
    mutationFn: () => api('deleteNotificationRoute', { params: { id: route.id }, reason: 'Remove channel' }),
    onSuccess: onChange,
  });
  return (
    <section className="card stack" aria-label={`Channel ${route.name}`}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>
          {route.name}{' '}
          <small style={{ color: 'var(--muted)' }}>
            {route.kind === 'slack' ? 'Slack' : 'Teams'} · {route.program_code ?? 'all programs'}
            {route.active ? '' : ' · paused'}
          </small>
        </h2>
        <div className="row">
          <button type="button" onClick={() => test.mutate()} disabled={test.isPending}>
            Send test
          </button>
          <button type="button" onClick={() => pause.mutate()}>
            {route.active ? 'Pause' : 'Resume'}
          </button>
          <button type="button" className="danger" onClick={() => remove.mutate()}>
            Remove
          </button>
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {route.url_hint} · {route.events.map((e) => EVENT_LABELS[e]).join(', ')}
      </p>
      {test.data && (
        <p role="status" style={{ margin: 0 }}>
          Test message{' '}
          {test.data.status === 'delivered' ? 'delivered' : `failed: ${test.data.error ?? 'unknown error'}`}
        </p>
      )}
      <ErrorMessage error={test.error ?? pause.error ?? remove.error ?? deliveries.error} />
      <table aria-label={`Deliveries of ${route.name}`} className="data-table">
        <thead>
          <tr>
            {['when', 'event', 'message', 'status', 'attempts'].map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(deliveries.data?.items ?? []).slice(0, 10).map((d) => (
            <tr key={d.id}>
              <td>{new Date(d.created_at).toLocaleString()}</td>
              <td>{d.event}</td>
              <td>{d.title}</td>
              <td>{d.status === 'failed' ? `failed (${d.error ?? ''})` : d.status}</td>
              <td>{d.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
