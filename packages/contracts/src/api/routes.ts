import { z } from 'zod';
import { HealthStatusSchema } from '../health.ts';
import {
  AccessTokenSchema,
  CreatedTokenSchema,
  CreateTokenBodySchema,
  LogoutResponseSchema,
  MeResponseSchema,
} from './auth.ts';
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
  TemplateListSchema,
  UpdateExperimentBodySchema,
  UpdateVersionBodySchema,
  UpsertSamplesBodySchema,
  VersionDetailSchema,
  VersionDiffSchema,
  VersionSummarySchema,
} from './registry.ts';

export interface ApiRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** OpenAPI-style path, e.g. `/v1/versions/{id}`. */
  path: string;
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  /** Success response (status `status`, default 200); undefined = no body. */
  response?: z.ZodType;
  status?: number;
  /** Sends `X-Change-Reason` (recorded in the audit log). */
  reason?: boolean;
}

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
} as const satisfies Record<string, ApiRoute>;

export type ApiOperation = keyof typeof API_ROUTES;
