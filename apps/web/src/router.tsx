import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { ForbiddenPage, Layout } from './components/Layout.tsx';
import { DatasetsPage, type DatasetsSearch } from './datasets/DatasetsPage.tsx';
import { ReleasePage } from './datasets/ReleasePage.tsx';
import { AdminPipelinesPage } from './pipelines/AdminPipelinesPage.tsx';
import { RunPage } from './pipelines/RunPage.tsx';
import { ExperimentPage } from './routes/ExperimentPage.tsx';
import { ExperimentsPage, type ExperimentsSearch } from './routes/ExperimentsPage.tsx';
import { HomePage } from './routes/HomePage.tsx';
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
const runRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs/$id', component: RunPage });
const adminPipelinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/pipelines',
  component: AdminPipelinesPage,
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
    releaseRoute,
    runRoute,
    adminPipelinesRoute,
    forbiddenRoute,
  ]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
