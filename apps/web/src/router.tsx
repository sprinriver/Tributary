import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { ForbiddenPage, Layout } from './components/Layout.tsx';
import { DatasetsPage, type DatasetsSearch } from './datasets/DatasetsPage.tsx';
import { ExplorerPage, type ExplorerSearch } from './explorer/ExplorerPage.tsx';
import { ComparePage } from './results/ComparePage.tsx';
import { CompoundPage, ProteinPage } from './results/EntityPages.tsx';
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
import { LineagePage, type LineageSearch } from './trust/LineagePage.tsx';
import { NewExperimentPage } from './routes/NewExperimentPage.tsx';

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
});
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
    proteinRoute,
    compoundRoute,
    compareRoute,
    releaseRoute,
    runRoute,
    adminPipelinesRoute,
    searchRoute,
    lineageRoute,
    auditRoute,
    templatesRoute,
    forbiddenRoute,
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
