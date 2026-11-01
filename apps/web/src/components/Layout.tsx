import { Link, Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import { useMe } from '../auth.ts';
import { AssistantPanel } from '../assistant/AssistantPanel.tsx';
import { SearchPalette } from '../search/SearchPalette.tsx';
import { ReauthDialog } from '../shell/ReauthDialog.tsx';
import { Sidebar } from '../shell/Sidebar.tsx';
import { TopBar } from '../shell/TopBar.tsx';
import { useCollapsed } from '../shell/theme.ts';

/** App shell (Celeste layout, ADR 0014): dark grouped sidebar, top bar with page title and account controls. */
export function Layout() {
  const me = useMe();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [drawer, setDrawer] = useState(false);
  const [assistant, setAssistant] = useState(false);
  return (
    <div className={`app${drawer ? ' drawer-open' : ''}`}>
      <div className="sidebar-rail">
        <Sidebar
          me={me.data}
          collapsed={collapsed}
          onToggle={toggleCollapsed}
          onNavigate={() => setDrawer(false)}
        />
      </div>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden="true" />
      <div className="app-body">
        <TopBar
          onOpenNav={() => setDrawer(true)}
          onAssistant={() => setAssistant((a) => !a)}
          assistantOpen={assistant}
        />
        {me.data && assistant && <AssistantPanel onClose={() => setAssistant(false)} />}
        {me.data && <SearchPalette />}
        {me.data && <ReauthDialog />}
        <div className="app-main">
          <Outlet />
        </div>
      </div>
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
