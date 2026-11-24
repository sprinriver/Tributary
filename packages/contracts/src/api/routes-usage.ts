import type { ApiRoute } from './route.ts';
import { UsageQuerySchema, UsageSchema } from './usage.ts';

/** Usage analytics (Phase 36; system admins). Part of API_ROUTES. */
export const USAGE_ROUTES = {
  getUsage: {
    method: 'get',
    path: '/v1/admin/usage',
    summary: 'Usage over recent weeks, per program and per person (system admin)',
    query: UsageQuerySchema,
    response: UsageSchema,
  },
  exportUsage: {
    method: 'get',
    path: '/v1/admin/usage/export',
    summary: 'The weekly usage table as CSV (system admin; the export is audited)',
    query: UsageQuerySchema,
  },
} as const satisfies Record<string, ApiRoute>;
