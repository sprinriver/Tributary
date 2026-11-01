import type { MeResponse } from '@tributary/contracts';
import { Link } from '@tanstack/react-router';
import { Icon, Logo } from '../components/Icon.tsx';
import { NAV_GROUPS } from './nav.ts';

const ROLE_LABEL: Record<string, string> = {
  system_admin: 'System admin',
  admin: 'Program admin',
  approver: 'Approver',
  contributor: 'Contributor',
  viewer: 'Viewer',
};
const ROLE_RANK = ['system_admin', 'admin', 'approver', 'contributor', 'viewer'];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** The caller's highest role, for the sidebar footer. */
function topRole(me: MeResponse): string {
  const roles = me.roles.map((r) => r.role as string);
  const best = ROLE_RANK.find((r) => roles.includes(r));
  return best ? ROLE_LABEL[best]! : 'No role yet';
}

export function Sidebar({
  me,
  collapsed,
  onToggle,
  onNavigate,
}: {
  me: MeResponse | null | undefined;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const isAdmin = !!me?.roles.some((r) => r.role === 'system_admin');
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sidebar">
      <div className="sidebar-brand">
        <Link
          to="/"
          onClick={onNavigate}
          style={{ display: 'flex', alignItems: 'center', gap: 11, textDecoration: 'none' }}
        >
          <Logo size={32} />
          {collapsed ? (
            <span className="sr-only">Tributary</span>
          ) : (
            <span>
              <div className="brand-name">Tributary</div>
              <div className="brand-tag">Experiment data platform</div>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            className="side-icon-button collapse-toggle"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <Icon name="panelLeft" />
          </button>
        )}
      </div>

      {me && (
        <button
          type="button"
          className="side-search"
          title="Search experiments and samples (⌘K / Ctrl+K)"
          onClick={() => document.dispatchEvent(new Event('tributary:search'))}
        >
          <Icon name="search" size={16} />
          {collapsed ? (
            <span className="sr-only">Search… ⌘K</span>
          ) : (
            <>
              Search… <kbd>⌘K</kbd>
            </>
          )}
        </button>
      )}

      <nav aria-label="Main">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.admin || isAdmin);
          if (!items.length) return null;
          return (
            <div key={group.label}>
              <div className="nav-group" aria-hidden="true">
                {group.label}
              </div>
              {items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="snav-item"
                  activeProps={{ className: 'snav-item active', 'aria-current': 'page' }}
                  activeOptions={{ exact: item.to === '/' }}
                  title={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                >
                  <span className="nav-ico">
                    <Icon name={item.icon} />
                  </span>
                  {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {collapsed ? (
          <button
            type="button"
            className="side-icon-button"
            onClick={onToggle}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <Icon name="chevronRight" />
          </button>
        ) : (
          me && (
            <div className="side-user">
              <div className="avatar" aria-hidden="true">
                {initials(me.user.name)}
              </div>
              <div style={{ minWidth: 0, lineHeight: 1.25 }}>
                <div className="side-user-name">{me.user.name}</div>
                <div className="side-user-role">{topRole(me)}</div>
              </div>
            </div>
          )
        )}
      </div>
    </aside>
  );
}
