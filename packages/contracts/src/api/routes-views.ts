import type { ApiRoute } from './route.ts';
import { CreateViewBodySchema, ViewListSchema, ViewSchema } from './views.ts';

/** Saved views (SPEC M6). Part of API_ROUTES. */
export const VIEW_ROUTES = {
  listViews: {
    method: 'get',
    path: '/v1/views',
    summary: 'My views and views shared with my programs',
    response: ViewListSchema,
  },
  createView: {
    method: 'post',
    path: '/v1/views',
    summary: 'Save a view (private, or for a program you can write to)',
    body: CreateViewBodySchema,
    response: ViewSchema,
    status: 201,
    reason: true,
  },
  getView: {
    method: 'get',
    path: '/v1/views/{id}',
    summary: 'A saved view (404 unless you may see it)',
    response: ViewSchema,
  },
  deleteView: {
    method: 'delete',
    path: '/v1/views/{id}',
    summary: 'Delete one of your views (soft delete)',
    status: 204,
    reason: true,
  },
} as const satisfies Record<string, ApiRoute>;
