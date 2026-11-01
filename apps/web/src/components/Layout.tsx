import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { loginHref, useMe } from '../auth.ts';
import { NotificationsMenu } from '../pipelines/NotificationsMenu.tsx';
import { SearchPalette } from '../search/SearchPalette.tsx';
import { UserMenu } from './UserMenu.tsx';

export function Layout() {
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.href });
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '8px 24px',
          borderBottom: '1px solid #d0d7de',
        }}
      >
        <Link to="/" style={{ fontWeight: 700, textDecoration: 'none', color: 'inherit' }}>
          Tributary
        </Link>
        <nav aria-label="Main" style={{ display: 'flex', gap: 12, flex: 1 }}>
          <Link to="/experiments">Experiments</Link>
          <Link to="/datasets">Datasets</Link>
          <Link to="/explore">Explore</Link>
          <Link to="/compare">Compare</Link>
          <Link to="/search">Search</Link>
          {me.data?.roles.some((r) => r.role === 'system_admin') && (
            <>
              <Link to="/admin/pipelines">Pipelines</Link>
              <Link to="/admin/audit">Audit</Link>
            </>
          )}
        </nav>
        {me.data && (
          <button
            type="button"
            title="Search (⌘K / Ctrl+K)"
            onClick={() => document.dispatchEvent(new Event('tributary:search'))}
          >
            Search… <kbd>⌘K</kbd>
          </button>
        )}
        {me.data && <NotificationsMenu />}
        {me.data ? (
          <UserMenu me={me.data} />
        ) : me.isPending ? null : me.isError ? (
          // Not "Sign in": the user may well be signed in; the API did not answer.
          <button type="button" onClick={() => void me.refetch()} title={me.error.message}>
            Account unavailable — retry
          </button>
        ) : (
          <a href={loginHref(path)}>Sign in</a>
        )}
      </header>
      {me.data && <SearchPalette />}
      <Outlet />
    </div>
  );
}

/** Wraps a page that needs a signed-in user. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useMe();
  if (me.isPending) return <main style={{ padding: 24 }}>Loading…</main>;
  if (me.isError) {
    return (
      <main style={{ padding: 24 }} role="alert">
        <h1>Could not load your account</h1>
        <p>{me.error.message}. Use retry at the top right, or reload the page.</p>
      </main>
    );
  }
  if (!me.data) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Sign in required</h1>
        <p>You need to sign in to see this page. Use Sign in at the top right.</p>
      </main>
    );
  }
  return <>{children}</>;
}

export function ForbiddenPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Access denied</h1>
      <p>You don&apos;t have a role in this program. Ask a program admin for access.</p>
      <Link to="/">Back to home</Link>
    </main>
  );
}
