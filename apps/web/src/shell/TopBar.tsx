import { useRouterState } from '@tanstack/react-router';
import { loginHref, useMe } from '../auth.ts';
import { Icon } from '../components/Icon.tsx';
import { UserMenu } from '../components/UserMenu.tsx';
import { NotificationsMenu } from '../pipelines/NotificationsMenu.tsx';
import { pageTitle } from './nav.ts';
import { useTheme } from './theme.ts';

export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.href });
  const { theme, toggle } = useTheme();
  return (
    <header className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <button type="button" className="hamburger tb-round" onClick={onOpenNav} aria-label="Open navigation">
          <Icon name="menu" />
        </button>
        <span className="topbar-title">{pageTitle(path)}</span>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="tb-round"
          onClick={toggle}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        {me.data && <NotificationsMenu />}
        {me.data ? (
          <UserMenu me={me.data} />
        ) : me.isPending ? null : me.isError ? (
          // Not "Sign in": the user may well be signed in; the API did not answer.
          <button type="button" onClick={() => void me.refetch()} title={me.error.message}>
            Account unavailable — retry
          </button>
        ) : (
          <a className="button primary" href={loginHref(path)}>
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}
