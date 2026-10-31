import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { loginHref, useMe } from '../auth.ts';
import { NotificationsMenu } from '../pipelines/NotificationsMenu.tsx';
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
          {me.data?.roles.some((r) => r.role === 'system_admin') && (
            <Link to="/admin/pipelines">Pipelines</Link>
          )}
        </nav>
        {me.data && <NotificationsMenu />}
        {me.data ? <UserMenu me={me.data} /> : me.isPending ? null : <a href={loginHref(path)}>Sign in</a>}
      </header>
      <Outlet />
    </div>
  );
}

/** Wraps a page that needs a signed-in user. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useMe();
  if (me.isPending) return <main style={{ padding: 24 }}>Loading…</main>;
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
