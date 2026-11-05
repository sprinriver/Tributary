import type { ApiRoute } from './route.ts';
import {
  AlertListSchema,
  AlertSchema,
  CreateWatchBodySchema,
  ListAlertsQuerySchema,
  WatchListSchema,
  WatchSchema,
} from './watch.ts';

/** Watchlists and alerts (Phase 26). Part of API_ROUTES. */
export const WATCH_ROUTES = {
  listWatches: { method: 'get', path: '/v1/watches', summary: 'My watchlist', response: WatchListSchema },
  createWatch: {
    method: 'post',
    path: '/v1/watches',
    summary: 'Watch a protein, gene or compound (returns the existing watch if already watched)',
    body: CreateWatchBodySchema,
    response: WatchSchema,
    status: 201,
  },
  deleteWatch: { method: 'delete', path: '/v1/watches/{id}', summary: 'Stop watching', status: 204 },
  listAlerts: {
    method: 'get',
    path: '/v1/alerts',
    summary: 'My alerts: new published releases with a hit for something I watch',
    query: ListAlertsQuerySchema,
    response: AlertListSchema,
  },
  readAlert: {
    method: 'post',
    path: '/v1/alerts/{id}/read',
    summary: 'Mark an alert read',
    response: AlertSchema,
  },
  readAllAlerts: {
    method: 'post',
    path: '/v1/alerts/read-all',
    summary: 'Mark all my alerts read',
    response: AlertListSchema,
  },
} as const satisfies Record<string, ApiRoute>;
