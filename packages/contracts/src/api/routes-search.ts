import type { ApiRoute } from './route.ts';
import { ReindexResponseSchema, SearchQuerySchema, SearchResponseSchema } from './search.ts';

/** Search (SPEC M9). Part of API_ROUTES. */
export const SEARCH_ROUTES = {
  search: {
    method: 'get',
    path: '/v1/search',
    summary: 'Search experiments and samples in your programs (full-text, optional embeddings, facets)',
    query: SearchQuerySchema,
    response: SearchResponseSchema,
  },
  reindexSearch: {
    method: 'post',
    path: '/v1/admin/search/reindex',
    summary: 'Rebuild every search document and fill missing embeddings (system admin)',
    response: ReindexResponseSchema,
    reason: true,
  },
} as const satisfies Record<string, ApiRoute>;
