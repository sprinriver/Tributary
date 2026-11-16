import {
  ProteinSitesQuerySchema,
  ProteinSitesSchema,
  SiteSummaryQuerySchema,
  SiteSummarySchema,
} from './ptm.ts';
import type { ApiRoute } from './route.ts';

/** Modification sites (Phase 47). Part of API_ROUTES. */
export const PTM_ROUTES = {
  getProteinSites: {
    method: 'get',
    path: '/v1/proteins/{id}/sites',
    summary: 'Modification sites of a protein across readable site releases, with a site map',
    query: ProteinSitesQuerySchema,
    response: ProteinSitesSchema,
  },
  getSiteSummary: {
    method: 'get',
    path: '/v1/ptm-sites/summary',
    summary: 'Sites, sites meeting a localisation threshold and sites per sample in one site release',
    query: SiteSummaryQuerySchema,
    response: SiteSummarySchema,
  },
} as const satisfies Record<string, ApiRoute>;
