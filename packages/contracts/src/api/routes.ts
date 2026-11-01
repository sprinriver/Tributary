import { z } from 'zod';
import { HealthStatusSchema } from '../health.ts';
import { CHART_ROUTES } from './routes-charts.ts';
import { DATASET_ROUTES } from './routes-datasets.ts';
import { FILE_ROUTES } from './routes-files.ts';
import { PIPELINE_ROUTES } from './routes-pipelines.ts';
import { QUERY_ROUTES } from './routes-query.ts';
import { RESULT_ROUTES } from './routes-results.ts';
import { SEARCH_ROUTES } from './routes-search.ts';
import { TRUST_ROUTES } from './routes-trust.ts';
import { ADMIN_ROUTES } from './routes-admin.ts';
import { AI_ROUTES } from './routes-ai.ts';
import { VIEW_ROUTES } from './routes-views.ts';
import type { ApiRoute } from './route.ts';
import {
  AccessTokenSchema,
  CreatedTokenSchema,
  CreateTokenBodySchema,
  LogoutResponseSchema,
  MeResponseSchema,
} from './auth.ts';
import {
  MappingPresetBodySchema,
  MappingPresetSchema,
  OntologySearchQuerySchema,
  OntologySearchResultSchema,
  SdrfImportBodySchema,
} from './manifest.ts';
import {
  CreateExperimentBodySchema,
  DeleteSamplesBodySchema,
  ExperimentDetailSchema,
  ExperimentListSchema,
  ItemsSchema,
  ListExperimentsQuerySchema,
  ProgramListSchema,
  PublishBodySchema,
  ReplaceContrastsBodySchema,
  SampleListSchema,
  SampleValidationSchema,
  ContrastRowSchema,
  ListTemplatesQuerySchema,
  TemplateListSchema,
  UpdateExperimentBodySchema,
  UpdateVersionBodySchema,
  UpsertSamplesBodySchema,
  VersionDetailSchema,
  VersionDiffSchema,
  VersionSummarySchema,
} from './registry.ts';

/**
 * Every public API operation. The API implements these paths; `pnpm gen` turns them into OpenAPI `paths`; the web
 * client is typed from them. Responses are validated against `response` in apps/api.
 */
export const API_ROUTES = {
  health: { method: 'get', path: '/healthz', summary: 'Liveness', response: HealthStatusSchema },
  me: {
    method: 'get',
    path: '/v1/auth/me',
    summary: 'The signed-in user and their roles',
    response: MeResponseSchema,
  },
  logout: {
    method: 'post',
    path: '/v1/auth/logout',
    summary: 'End the browser session',
    response: LogoutResponseSchema,
  },
  listTokens: {
    method: 'get',
    path: '/v1/auth/tokens',
    summary: 'My access tokens',
    response: z.array(AccessTokenSchema),
  },
  createToken: {
    method: 'post',
    path: '/v1/auth/tokens',
    summary: 'Create a personal access token (shown once)',
    body: CreateTokenBodySchema,
    response: CreatedTokenSchema,
    status: 201,
  },
  revokeToken: {
    method: 'delete',
    path: '/v1/auth/tokens/{id}',
    summary: 'Revoke an access token',
    status: 204,
  },
  listPrograms: {
    method: 'get',
    path: '/v1/programs',
    summary: 'Programs I can read',
    response: ProgramListSchema,
  },
  listTemplates: {
    method: 'get',
    path: '/v1/templates',
    summary: 'Metadata templates',
    query: ListTemplatesQuerySchema,
    response: TemplateListSchema,
  },
  listExperiments: {
    method: 'get',
    path: '/v1/experiments',
    summary: 'List experiments (filters, sort, cursor pagination)',
    query: ListExperimentsQuerySchema,
    response: ExperimentListSchema,
  },
  createExperiment: {
    method: 'post',
    path: '/v1/experiments',
    summary: 'Create an experiment and its first draft version',
    body: CreateExperimentBodySchema,
    response: ExperimentDetailSchema,
    status: 201,
    reason: true,
  },
  getExperiment: {
    method: 'get',
    path: '/v1/experiments/{id}',
    summary: 'Experiment with versions',
    response: ExperimentDetailSchema,
  },
  updateExperiment: {
    method: 'patch',
    path: '/v1/experiments/{id}',
    summary: 'Rename an experiment',
    body: UpdateExperimentBodySchema,
    response: ExperimentDetailSchema,
    reason: true,
  },
  archiveExperiment: {
    method: 'post',
    path: '/v1/experiments/{id}/archive',
    summary: 'Hide from default lists',
    response: ExperimentDetailSchema,
    reason: true,
  },
  unarchiveExperiment: {
    method: 'post',
    path: '/v1/experiments/{id}/unarchive',
    summary: 'Show in default lists again',
    response: ExperimentDetailSchema,
    reason: true,
  },
  listVersions: {
    method: 'get',
    path: '/v1/experiments/{id}/versions',
    summary: 'Version history',
    response: ItemsSchema(VersionSummarySchema),
  },
  getVersion: {
    method: 'get',
    path: '/v1/versions/{id}',
    summary: 'Version detail',
    response: VersionDetailSchema,
  },
  updateVersion: {
    method: 'patch',
    path: '/v1/versions/{id}',
    summary: 'Edit a draft version',
    body: UpdateVersionBodySchema,
    response: VersionDetailSchema,
    reason: true,
  },
  publishVersion: {
    method: 'post',
    path: '/v1/versions/{id}/publish',
    summary: 'Validate and publish a draft (reason required)',
    body: PublishBodySchema,
    response: VersionDetailSchema,
  },
  cloneVersion: {
    method: 'post',
    path: '/v1/versions/{id}/clone',
    summary: 'Create a new draft from this version',
    response: VersionDetailSchema,
    status: 201,
    reason: true,
  },
  archiveVersion: {
    method: 'post',
    path: '/v1/versions/{id}/archive',
    summary: 'Archive a published version',
    response: VersionDetailSchema,
    reason: true,
  },
  diffVersions: {
    method: 'get',
    path: '/v1/versions/{id}/diff/{otherId}',
    summary: 'Changes from this version to another',
    response: VersionDiffSchema,
  },
  listSamples: {
    method: 'get',
    path: '/v1/versions/{id}/samples',
    summary: 'Samples of a version',
    response: SampleListSchema,
  },
  upsertSamples: {
    method: 'put',
    path: '/v1/versions/{id}/samples',
    summary: 'Insert or update samples by key (errors are stored per cell)',
    body: UpsertSamplesBodySchema,
    response: SampleValidationSchema,
    reason: true,
  },
  deleteSamples: {
    method: 'delete',
    path: '/v1/versions/{id}/samples',
    summary: 'Remove samples by key',
    body: DeleteSamplesBodySchema,
    status: 204,
    reason: true,
  },
  validateSamples: {
    method: 'post',
    path: '/v1/versions/{id}/samples/validate',
    summary: 'Validate rows without saving',
    body: UpsertSamplesBodySchema,
    response: SampleValidationSchema,
  },
  listContrasts: {
    method: 'get',
    path: '/v1/versions/{id}/contrasts',
    summary: 'Contrasts of a version',
    response: ItemsSchema(ContrastRowSchema),
  },
  replaceContrasts: {
    method: 'put',
    path: '/v1/versions/{id}/contrasts',
    summary: 'Replace the contrasts of a draft',
    body: ReplaceContrastsBodySchema,
    response: ItemsSchema(ContrastRowSchema),
    reason: true,
  },
  searchOntology: {
    method: 'get',
    path: '/v1/ontology/search',
    summary: 'Ontology term typeahead (OLS4, cached in Postgres)',
    query: OntologySearchQuerySchema,
    response: OntologySearchResultSchema,
  },
  listMappingPresets: {
    method: 'get',
    path: '/v1/programs/{id}/mapping-presets',
    summary: 'Column-mapping presets of a program',
    response: ItemsSchema(MappingPresetSchema),
  },
  createMappingPreset: {
    method: 'post',
    path: '/v1/programs/{id}/mapping-presets',
    summary: 'Save a column-mapping preset',
    body: MappingPresetBodySchema,
    response: MappingPresetSchema,
    status: 201,
  },
  exportSdrf: {
    method: 'get',
    path: '/v1/versions/{id}/sdrf',
    summary: 'Download the manifest as SDRF-Proteomics (validated with sdrf-pipelines)',
  },
  importSdrf: {
    method: 'post',
    path: '/v1/versions/{id}/sdrf',
    summary: 'Import an SDRF file into a draft (rows upserted by sample key)',
    body: SdrfImportBodySchema,
    response: SampleValidationSchema,
    reason: true,
  },
  ...FILE_ROUTES,
  ...DATASET_ROUTES,
  ...PIPELINE_ROUTES,
  ...QUERY_ROUTES,
  ...VIEW_ROUTES,
  ...SEARCH_ROUTES,
  ...TRUST_ROUTES,
  ...ADMIN_ROUTES,
  ...CHART_ROUTES,
  ...RESULT_ROUTES,
  ...AI_ROUTES,
} as const satisfies Record<string, ApiRoute>;

export type ApiOperation = keyof typeof API_ROUTES;

export type { ApiRoute } from './route.ts';
