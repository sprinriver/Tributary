import { PERSONAL_EVENTS, type PersonalEvent } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage } from '../components/ui.tsx';

const LABELS: Record<PersonalEvent, { title: string; hint: string }> = {
  'alert.created': {
    title: 'New hits for items I watch',
    hint: 'One email per newly published release with hits for proteins, genes or compounds you watch.',
  },
  'triage.assigned': {
    title: 'Triage items assigned to me',
    hint: 'When someone makes you the owner of a triage item.',
  },
  'run.finished': {
    title: 'My pipeline runs finish',
    hint: 'When a run you launched succeeds, fails or is cancelled.',
  },
};

/** Personal email settings (Phase 34, MAIL-01). */
export function NotificationSettingsPage() {
  const client = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api('getNotificationPreferences'),
  });
  const [draft, setDraft] = useState<{ email: boolean; events: PersonalEvent[] } | null>(null);
  const current = draft ?? (prefs.data ? { email: prefs.data.email, events: prefs.data.events } : null);
  const save = useMutation({
    mutationFn: () =>
      api('putNotificationPreferences', { body: current!, reason: 'Change my email notifications' }),
    onSuccess: async (saved) => {
      setDraft(null);
      client.setQueryData(['notification-preferences'], saved);
    },
  });
  const toggle = (e: PersonalEvent) =>
    current &&
    setDraft({
      ...current,
      events: current.events.includes(e) ? current.events.filter((x) => x !== e) : [...current.events, e],
    });
  return (
    <RequireAuth>
      <main className="stack">
        <h1>Email notifications</h1>
        <ErrorMessage error={prefs.error ?? save.error} />
        {prefs.data && !prefs.data.email_available && (
          <p role="note" className="hint" style={{ margin: 0 }}>
            Email is not set up on this installation yet, so nothing is sent. Your choices are kept for when
            it is.
          </p>
        )}
        {prefs.data && current && (
          <section className="card stack" aria-label="Email settings">
            <label className="row" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={current.email}
                onChange={(e) => setDraft({ ...current, email: e.target.checked })}
              />
              <span>
                Send me emails at <strong>{prefs.data.address || 'no address on file'}</strong>
              </span>
            </label>
            <fieldset
              className="stack"
              style={{ border: 0, padding: 0, margin: 0 }}
              disabled={!current.email}
            >
              <legend className="hint">About</legend>
              {PERSONAL_EVENTS.map((e) => (
                <label key={e} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={current.events.includes(e)} onChange={() => toggle(e)} />
                  <span>
                    {LABELS[e].title}
                    <br />
                    <span className="hint">{LABELS[e].hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="hint" style={{ margin: 0 }}>
              Emails contain names and a link back to Tributary, never data values.
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={draft === null || save.isPending}
                onClick={() => save.mutate()}
              >
                Save
              </button>
              {save.isSuccess && draft === null && <span role="status">Saved</span>}
            </div>
          </section>
        )}
      </main>
    </RequireAuth>
  );
}
