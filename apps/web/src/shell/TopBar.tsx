import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { api } from '../api.ts';
import { loginHref, useMe } from '../auth.ts';
import { Icon } from '../components/Icon.tsx';
import { UserMenu } from '../components/UserMenu.tsx';
import { NotificationsMenu } from '../pipelines/NotificationsMenu.tsx';
import { pageTitle } from './nav.ts';
import { useTheme } from './theme.ts';

export function TopBar({
  onOpenNav,
  onAssistant,
  assistantOpen,
}: {
  onOpenNav: () => void;
  onAssistant: () => void;
  assistantOpen: boolean;
}) {
  const me = useMe();
  // The assistant is off by default (SPEC §11.1); the button appears only when the deployment switched it on.
  const ai = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => api('getAiSettings'),
    enabled: !!me.data,
    staleTime: 60_000,
  });
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
        {me.data && ai.data?.enabled && (
          <button
            type="button"
            className="tb-chip"
            onClick={onAssistant}
            aria-pressed={assistantOpen}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="sparkle" size={15} />
            Assistant
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
          <a className="button primary" href={loginHref(path)}>
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}
