import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { ForbiddenPage, Layout } from './components/Layout.tsx';
import { ExperimentsPage } from './routes/ExperimentsPage.tsx';
import { HomePage } from './routes/HomePage.tsx';

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });
const experimentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/experiments',
  component: ExperimentsPage,
});
const forbiddenRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forbidden',
  component: ForbiddenPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, experimentsRoute, forbiddenRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
