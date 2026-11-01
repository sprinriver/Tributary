import {
  ReindexResponseSchema,
  SEARCH_FACETS,
  SearchQuerySchema,
  SearchResponseSchema,
  type SearchFacet,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { readablePrograms, requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, parse } from '../errors.ts';
import { respond } from '../respond.ts';
import type { EmbeddingProvider } from '../search/embeddings.ts';
import type { SearchIndex } from '../search/index-service.ts';
import { decodeCursor, runSearch } from '../search/run.ts';

const FILTER_PARAM: Record<SearchFacet, 'assay_type' | 'program_id' | 'species' | 'compound' | 'status'> = {
  assay_type: 'assay_type',
  program: 'program_id',
  species: 'species',
  compound: 'compound',
  status: 'status',
};

interface Deps {
  db: Database;
  config: ApiConfig;
  provider: EmbeddingProvider | null;
  index: SearchIndex;
}

/** Search (SPEC M9): GET /v1/search for everyone signed in; reindex for system admins. */
export function registerSearchRoutes(app: FastifyInstance, { db, config, provider, index }: Deps): void {
  app.get('/v1/search', async (request) => {
    const principal = requirePrincipal(request);
    const query = parse(SearchQuerySchema, request.query);
    const offset = decodeCursor(query.cursor);
    if (offset < 0) throw new HttpError(400, 'invalid_cursor', 'The cursor is not valid.', 'cursor');
    const filters = Object.fromEntries(
      SEARCH_FACETS.map((f) => [f, [query[FILTER_PARAM[f]] ?? []].flat()]),
    ) as Record<SearchFacet, string[]>;
    const result = await runSearch(
      db,
      readablePrograms(principal),
      { q: query.q, type: query.type, filters, limit: query.limit ?? 20, offset },
      provider,
      config.search.minSimilarity,
      request.log,
    );
    return respond(SearchResponseSchema, result);
  });

  app.post('/v1/admin/search/reindex', async (request) => {
    const principal = requireSystemAdmin(request);
    const result = await index.rebuild(principal.userId);
    const body = { ...result, provider: config.search.provider };
    await insertAudit(db, requestActor(request), {
      action: 'search.reindex',
      entityType: 'search_index',
      // The index belongs to the tenant (audit_log.entity_id is required).
      entityId: principal.tenantId,
      after: body,
    });
    return respond(ReindexResponseSchema, body);
  });
}
