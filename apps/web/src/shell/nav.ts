import type { IconName } from '../components/Icon.tsx';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Only for system admins. */
  admin?: boolean;
}

/** Sidebar navigation, grouped as in the Celeste shell. Labels are also the links' accessible names. */
export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: 'home' },
      { to: '/experiments', label: 'Experiments', icon: 'flask' },
      { to: '/datasets', label: 'Datasets', icon: 'database' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to: '/explore', label: 'Explore', icon: 'table' },
      { to: '/views', label: 'Saved views', icon: 'table' },
      { to: '/compare', label: 'Compare', icon: 'compare' },
      { to: '/triage', label: 'Triage', icon: 'workflow' },
      { to: '/search', label: 'Search', icon: 'search' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/admin/pipelines', label: 'Pipelines', icon: 'workflow', admin: true },
      { to: '/admin/programs', label: 'Programs', icon: 'home', admin: true },
      { to: '/admin/templates', label: 'Templates', icon: 'flask', admin: true },
      { to: '/admin/lists', label: 'Lists', icon: 'table', admin: true },
      { to: '/admin/access', label: 'Access', icon: 'shield', admin: true },
      { to: '/admin/lifecycle', label: 'Lifecycle', icon: 'database', admin: true },
      { to: '/admin/health', label: 'Health', icon: 'lineage', admin: true },
      { to: '/admin/audit', label: 'Audit', icon: 'shield', admin: true },
    ],
  },
];

/** Page title for the top bar: the deepest matching nav item, else a name from the path. */
export function pageTitle(path: string): string {
  const pathname = path.split('?')[0] ?? '/';
  const items = NAV_GROUPS.flatMap((g) => g.items);
  const match = items
    .filter((i) => (i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(`${i.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  if (match) return match.label;
  if (pathname.startsWith('/releases/')) return 'Datasets';
  if (pathname.startsWith('/runs/')) return 'Pipeline run';
  if (pathname.startsWith('/lineage/')) return 'Lineage';
  if (pathname.startsWith('/proteins/')) return 'Protein';
  if (pathname.startsWith('/compounds/')) return 'Compound';
  return 'Tributary';
}
