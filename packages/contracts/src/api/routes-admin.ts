import {
  AdminTemplateListQuerySchema,
  AdminTemplateListSchema,
  AdminTemplateSchema,
  CreateTemplateBodySchema,
  PublishTemplateBodySchema,
  TemplatePreviewSchema,
} from './admin-templates.ts';
import type { ApiRoute } from './route.ts';

/** Admin (SPEC M11). Part of API_ROUTES. */
export const ADMIN_ROUTES = {
  listAdminTemplates: {
    method: 'get',
    path: '/v1/admin/templates',
    summary: 'Template versions of an assay type with how many experiment versions pin each (system admin)',
    query: AdminTemplateListQuerySchema,
    response: AdminTemplateListSchema,
  },
  createTemplate: {
    method: 'post',
    path: '/v1/admin/templates',
    summary: 'Create the next template version as a draft (system admin)',
    body: CreateTemplateBodySchema,
    response: AdminTemplateSchema,
    status: 201,
    reason: true,
  },
  previewTemplate: {
    method: 'get',
    path: '/v1/admin/templates/{assay_type}/{version}/preview',
    summary: 'Migration preview: field changes against the current version and pinned counts',
    response: TemplatePreviewSchema,
  },
  publishTemplate: {
    method: 'post',
    path: '/v1/admin/templates/{assay_type}/{version}/publish',
    summary: 'Publish a draft template version; new drafts pin it, existing versions keep theirs',
    body: PublishTemplateBodySchema,
    response: AdminTemplateSchema,
  },
} as const satisfies Record<string, ApiRoute>;
