import {
  LaunchRunBodySchema,
  PipelineDefinitionBodySchema,
  PipelineSchema,
  PipelineListSchema,
  RunDetailSchema,
  RunListSchema,
  RunLogsSchema,
} from './pipelines.ts';
import type { ApiRoute } from './route.ts';

/** Pipelines and runs (SPEC M4). Part of API_ROUTES. */
export const PIPELINE_ROUTES = {
  listPipelines: {
    method: 'get',
    path: '/v1/pipelines',
    summary: 'Pipeline definitions',
    response: PipelineListSchema,
  },
  createPipeline: {
    method: 'post',
    path: '/v1/admin/pipelines',
    summary: 'Add a pipeline definition (system admin)',
    body: PipelineDefinitionBodySchema,
    response: PipelineSchema,
    status: 201,
    reason: true,
  },
  launchRun: {
    method: 'post',
    path: '/v1/runs',
    summary: 'Launch a pipeline on a published version (422 while the QC gate blocks)',
    body: LaunchRunBodySchema,
    response: RunDetailSchema,
    status: 201,
    reason: true,
  },
  getRun: {
    method: 'get',
    path: '/v1/runs/{id}',
    summary: 'A run with its status history and outputs',
    response: RunDetailSchema,
  },
  listVersionRuns: {
    method: 'get',
    path: '/v1/versions/{id}/runs',
    summary: 'Runs of an experiment version',
    response: RunListSchema,
  },
  cancelRun: {
    method: 'post',
    path: '/v1/runs/{id}/cancel',
    summary: 'Ask the runner to cancel',
    response: RunDetailSchema,
    reason: true,
  },
  getRunLogs: {
    method: 'get',
    path: '/v1/runs/{id}/logs',
    summary: 'Log links and recent log lines',
    response: RunLogsSchema,
  },
} as const satisfies Record<string, ApiRoute>;
