import { ViewsPage } from './explorer/ViewsPage.tsx';
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { ForbiddenPage, Layout } from './components/Layout.tsx';
import { DatasetsPage, type DatasetsSearch } from './datasets/DatasetsPage.tsx';
import { ExplorerPage, type ExplorerSearch } from './explorer/ExplorerPage.tsx';
import { ComparePage } from './results/ComparePage.tsx';
import { CompoundPage, ProteinPage } from './results/EntityPages.tsx';
import { ReportPage } from './results/ReportPage.tsx';
import { ResultsPage } from './results/ResultsPage.tsx';
import { ReleasePage } from './datasets/ReleasePage.tsx';
import { AdminPipelinesPage } from './pipelines/AdminPipelinesPage.tsx';
import { RunPage } from './pipelines/RunPage.tsx';
import { ExperimentPage } from './routes/ExperimentPage.tsx';
import { ExperimentsPage, type ExperimentsSearch } from './routes/ExperimentsPage.tsx';
import { HomePage } from './routes/HomePage.tsx';
import { SearchPage, type SearchPageSearch } from './search/SearchPage.tsx';
import { AuditPage, type AuditSearch } from './trust/AuditPage.tsx';
import { TemplatesPage } from './admin/TemplatesPage.tsx';
import { AccessPage } from './admin/AccessPage.tsx';
import { HealthPage } from './admin/HealthPage.tsx';
import { LifecyclePage } from './admin/LifecyclePage.tsx';
import { ListsPage } from './admin/ListsPage.tsx';
import { NotificationsPage } from './admin/NotificationsPage.tsx';
import { UsagePage } from './admin/UsagePage.tsx';
import { NotificationSettingsPage } from './settings/NotificationSettingsPage.tsx';
import { ProgramsPage } from './admin/ProgramsPage.tsx';
import { LineagePage, type LineageSearch } from './trust/LineagePage.tsx';
import { NewExperimentPage } from './routes/NewExperimentPage.tsx';
import { CompoundSearchPage, type CompoundSearchSearch } from './chem/CompoundSearchPage.tsx';
import { QcPage, type QcSearch } from './qc/QcPage.tsx';
import { SelectivityPage, type SelectivitySearch } from './results/SelectivityPage.tsx';
import { TriagePage, type TriageSearch } from './triage/TriagePage.tsx';

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const experimentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/experiments',
  component: ExperimentsPage,
  validateSearch: (search: Record<string, unknown>): ExperimentsSearch =>
    Object.fromEntries(
      ['name', 'q', 'assay_type', 'program_id', 'date_from', 'date_to', 'include_archived', 'sort', 'dir']
        .map((k) => [k, str(search[k])])
        .filter(([, v]) => v !== undefined),
    ) as ExperimentsSearch,
});
const newExperimentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/experiments/new',
  component: NewExperimentPage,
});
const experimentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/experiments/$id',
  component: ExperimentPage,
  validateSearch: (search: Record<string, unknown>): { version?: string } => {
    const version = str(search.version);
    return version ? { version } : {};
  },
});
const datasetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/datasets',
  component: DatasetsPage,
  validateSearch: (search: Record<string, unknown>): DatasetsSearch =>
    Object.fromEntries(
      ['kind', 'q'].map((k) => [k, str(search[k])]).filter(([, v]) => v !== undefined),
    ) as DatasetsSearch,
});
const releaseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/releases/$id',
  component: ReleasePage,
});
const explorerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/explore',
  component: ExplorerPage,
  validateSearch: (search: Record<string, unknown>): ExplorerSearch =>
    Object.fromEntries(
      ['q', 'view'].map((k) => [k, str(search[k])]).filter(([, v]) => v !== undefined),
    ) as ExplorerSearch,
});
const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/experiments/$id/report',
  component: ReportPage,
  validateSearch: (search: Record<string, unknown>): { version?: string } => {
    const version = str(search.version);
    return version ? { version } : {};
  },
});
const resultsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/experiments/$id/results',
  component: ResultsPage,
  validateSearch: (search: Record<string, unknown>): { version?: string } => {
    const version = str(search.version);
    return version ? { version } : {};
  },
});
const proteinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/proteins/$id',
  component: ProteinPage,
});
const compoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compounds/$id',
  component: CompoundPage,
  // sel_release, pec50 and sel_dir: the selectivity section's dataset, threshold and direction (shareable).
  validateSearch: (
    search: Record<string, unknown>,
  ): { program_id?: string; sel_release?: string; pec50?: string; sel_dir?: string } => ({
    ...(str(search.program_id) ? { program_id: str(search.program_id)! } : {}),
    ...(str(search.sel_release) ? { sel_release: str(search.sel_release)! } : {}),
    ...(str(search.sel_dir) ? { sel_dir: str(search.sel_dir)! } : {}),
    // The router parses `pec50=7` as a number.
    ...(typeof search.pec50 === 'number' || str(search.pec50) ? { pec50: String(search.pec50) } : {}),
  }),
});
const compoundSearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compounds/search',
  component: CompoundSearchPage,
  validateSearch: (search: Record<string, unknown>): CompoundSearchSearch => {
    const mode = str(search.mode);
    const type = str(search.type);
    const min = Number(search.min);
    return {
      ...(str(search.q) ? { q: str(search.q)! } : {}),
      ...(mode === 'substructure' || mode === 'similarity' ? { mode } : {}),
      ...(type === 'smarts' || type === 'smiles' ? { type } : {}),
      ...(Number.isFinite(min) && min > 0 && min <= 1 ? { min } : {}),
    };
  },
});
const viewsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/views', component: ViewsPage });
const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compare',
  component: ComparePage,
});
const runRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs/$id', component: RunPage });
const adminPipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/pipelines',
  component: AdminPipelinesPage,
});
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: SearchPage,
  validateSearch: (search: Record<string, unknown>): SearchPageSearch => {
    const out = Object.fromEntries(
      ['q', 'assay_type', 'program_id', 'species', 'compound', 'status']
        .map((k) => [k, str(search[k])])
        .filter(([, v]) => v !== undefined),
    ) as SearchPageSearch;
    const type = str(search.type);
    return type === 'experiment' || type === 'sample' ? { ...out, type } : out;
  },
});
const qcRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/qc',
  component: QcPage,
  validateSearch: (search: Record<string, unknown>): QcSearch => {
    const color = str(search.color_by);
    return {
      ...(str(search.program_id) ? { program_id: str(search.program_id)! } : {}),
      ...(color === 'experiment' || color === 'plate' || color === 'condition' || color === 'experiment_date'
        ? { color_by: color }
        : {}),
    };
  },
});
const selectivityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/selectivity',
  component: SelectivityPage,
  validateSearch: (search: Record<string, unknown>): SelectivitySearch => ({
    ...(str(search.program_id) ? { program_id: str(search.program_id)! } : {}),
    ...(typeof search.pec50 === 'number' || str(search.pec50) ? { pec50: String(search.pec50) } : {}),
    ...(search.dir === 'down' || search.dir === 'up' ? { dir: search.dir } : {}),
  }),
});
const triageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/triage',
  component: TriagePage,
  validateSearch: (search: Record<string, unknown>): TriageSearch => {
    const kind = str(search.kind);
    return {
      ...(str(search.item) ? { item: str(search.item)! } : {}),
      ...(str(search.program_id) ? { program_id: str(search.program_id)! } : {}),
      ...(kind === 'protein' || kind === 'compound' ? { kind } : {}),
    };
  },
});
const lineageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/lineage/$kind/$id',
  component: LineagePage,
  validateSearch: (search: Record<string, unknown>): LineageSearch => {
    const depth = Number(search.depth);
    const direction = str(search.direction);
    return {
      ...(Number.isInteger(depth) && depth >= 1 && depth <= 6 ? { depth } : {}),
      ...(direction === 'upstream' || direction === 'downstream' || direction === 'both'
        ? { direction }
        : {}),
    };
  },
});
const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/templates',
  component: TemplatesPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/notifications',
  component: NotificationSettingsPage,
});
const adminPage = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });
const adminRoutes = [
  adminPage('/admin/programs', ProgramsPage),
  adminPage('/admin/lists', ListsPage),
  adminPage('/admin/notifications', NotificationsPage),
  adminPage('/admin/usage', UsagePage),
  adminPage('/admin/access', AccessPage),
  adminPage('/admin/lifecycle', LifecyclePage),
  adminPage('/admin/health', HealthPage),
];
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/audit',
  component: AuditPage,
  validateSearch: (search: Record<string, unknown>): AuditSearch =>
    Object.fromEntries(
      ['action', 'entity_type', 'entity_id', 'from', 'to']
        .map((k) => [k, str(search[k])])
        .filter(([, v]) => v !== undefined),
    ) as AuditSearch,
});
const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forbidden',
  component: ForbiddenPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    experimentsRoute,
    newExperimentRoute,
    experimentRoute,
    datasetsRoute,
    explorerRoute,
    resultsRoute,
    reportRoute,
    proteinRoute,
    compoundSearchRoute,
    compoundRoute,
    compareRoute,
    triageRoute,
    qcRoute,
    selectivityRoute,
    viewsRoute,
    releaseRoute,
    runRoute,
    adminPipelinesRoute,
    searchRoute,
    lineageRoute,
    auditRoute,
    templatesRoute,
    ...adminRoutes,
    settingsRoute,
    forbiddenRoute,
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
