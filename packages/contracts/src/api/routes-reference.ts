import { UniprotRefreshBodySchema, UniprotRefreshResultSchema } from './results.ts';
import type { ApiRoute } from './route.ts';

/** Reference data from public sources (public annotation plan, stage 1). Part of API_ROUTES. */
export const REFERENCE_ROUTES = {
  refreshUniprot: {
    method: 'post',
    path: '/v1/admin/reference/uniprot',
    summary:
      'Refresh protein facts from UniProt for the accessions in published results; stores them with the UniProt release (system admin)',
    body: UniprotRefreshBodySchema,
    response: UniprotRefreshResultSchema,
    reason: true,
  },
} as const satisfies Record<string, ApiRoute>;
