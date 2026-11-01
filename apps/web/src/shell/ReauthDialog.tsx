import { useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Dialog } from '../components/ui.tsx';

/** Re-authentication URL: the IdP asks for credentials again (prompt=login, max_age=0), then returns here. */
export const reauthHref = (returnTo: string) =>
  `/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}&reauth=1`;

/**
 * Shown when the API answers `reauth_required` (publish, approve, reject, QC override with an old sign-in).
 * The action is not retried automatically: after signing in again the user repeats it deliberately.
 */
export function ReauthDialog() {
  const [message, setMessage] = useState<string | null>(null);
  const path = useRouterState({ select: (s) => s.location.href });
  useEffect(() => {
    const onReauth = (e: Event) => setMessage(String((e as CustomEvent<string>).detail ?? ''));
    document.addEventListener('tributary:reauth', onReauth);
    return () => document.removeEventListener('tributary:reauth', onReauth);
  }, []);
  return (
    <Dialog title="Confirm it’s you" open={message !== null} onClose={() => setMessage(null)}>
      <div className="stack">
        <p style={{ margin: 0 }}>
          {message || 'Sign in again to confirm it is you.'} Publishing and approving are recorded under your
          name, so they need a recent sign-in.
        </p>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          You will come back to this page; then repeat the action.
        </p>
        <div className="toolbar">
          <button type="button" onClick={() => setMessage(null)}>
            Cancel
          </button>
          <a className="button primary" href={reauthHref(path)}>
            Sign in again
          </a>
        </div>
      </div>
    </Dialog>
  );
}
