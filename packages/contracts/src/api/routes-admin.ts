import {
  AdminTemplateListQuerySchema,
  AdminTemplateListSchema,
  AdminTemplateSchema,
  CreateTemplateBodySchema,
  PublishTemplateBodySchema,
  TemplatePreviewSchema,
} from './admin-templates.ts';
import {
  CreateProgramBodySchema,
  GroupMappingsSchema,
  HealthReportSchema,
  OntologySourcesSchema,
  PicklistQuerySchema,
  PicklistSchema,
  PutGroupMappingsBodySchema,
  PutOntologySourcesBodySchema,
  PutPicklistBodySchema,
  UpdateProgramBodySchema,
} from './admin-settings.ts';
import { ProgramRowSchema } from './registry.ts';
import type { ApiRoute } from './route.ts';
import { SupportBundleSchema } from './support.ts';

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
  createProgram: {
    method: 'post',
    path: '/v1/admin/programs',
    summary: 'Create a program (system admin)',
    body: CreateProgramBodySchema,
    response: ProgramRowSchema,
    status: 201,
    reason: true,
  },
  updateProgram: {
    method: 'patch',
    path: '/v1/admin/programs/{id}',
    summary: 'Rename a program or change whether publishing needs an approver (system admin)',
    body: UpdateProgramBodySchema,
    response: ProgramRowSchema,
    reason: true,
  },
  getPicklist: {
    method: 'get',
    path: '/v1/picklists',
    summary: 'Values offered by registry forms (species, spectral libraries, time points)',
    query: PicklistQuerySchema,
    response: PicklistSchema,
  },
  putPicklist: {
    method: 'put',
    path: '/v1/admin/picklists/{kind}',
    summary: 'Replace a picklist (system admin)',
    body: PutPicklistBodySchema,
    response: PicklistSchema,
    reason: true,
  },
  getOntologySources: {
    method: 'get',
    path: '/v1/admin/ontology-sources',
    summary: 'Ontologies the manifest editor may look up (system admin)',
    response: OntologySourcesSchema,
  },
  putOntologySources: {
    method: 'put',
    path: '/v1/admin/ontology-sources',
    summary: 'Choose the enabled ontology sources (system admin)',
    body: PutOntologySourcesBodySchema,
    response: OntologySourcesSchema,
    reason: true,
  },
  getGroupMappings: {
    method: 'get',
    path: '/v1/admin/group-mappings',
    summary: 'IdP group → role mappings (system admin)',
    response: GroupMappingsSchema,
  },
  putGroupMappings: {
    method: 'put',
    path: '/v1/admin/group-mappings',
    summary: 'Replace the stored IdP group → role mappings (system admin)',
    body: PutGroupMappingsBodySchema,
    response: GroupMappingsSchema,
    reason: true,
  },
  getSupportBundle: {
    method: 'get',
    path: '/v1/admin/support-bundle',
    summary:
      'Support bundle: versions, migrations, health, configuration summary, recent failures (no secrets; audited)',
    response: SupportBundleSchema,
  },
  getSystemHealth: {
    method: 'get',
    path: '/v1/admin/health',
    summary: 'Dependency checks, runner configuration and AI settings (system admin)',
    response: HealthReportSchema,
  },
} as const satisfies Record<string, ApiRoute>;
