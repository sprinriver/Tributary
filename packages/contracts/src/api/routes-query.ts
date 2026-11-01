import { QuerySpecSchema } from '../query.ts';
import { QueryExportBodySchema, QueryExportSchema, QueryResultSchema } from './query.ts';
import type { ApiRoute } from './route.ts';

/** QuerySpec → page and export (SPEC §7.1, M6). Part of API_ROUTES. */
export const QUERY_ROUTES = {
  runQuery: {
    method: 'post',
    path: '/v1/query',
    summary: 'Run a QuerySpec: one page of rows (scoped to your programs)',
    body: QuerySpecSchema,
    response: QueryResultSchema,
  },
  exportQuery: {
    method: 'post',
    path: '/v1/query/export',
    summary: 'Export a QuerySpec result as CSV, TSV or Parquet (audited); returns a presigned URL',
    body: QueryExportBodySchema,
    response: QueryExportSchema,
    status: 201,
    reason: true,
  },
} as const satisfies Record<string, ApiRoute>;
