import {
  DatasetDetailSchema,
  DatasetListSchema,
  ImporterListSchema,
  ImportPresetBodySchema,
  ImportPresetSchema,
  ListDatasetsQuerySchema,
  PreviewQuerySchema,
  ReleaseDetailSchema,
  ReleasePreviewSchema,
  ReleaseReasonBodySchema,
  StartImportBodySchema,
} from './datasets.ts';
import { ItemsSchema } from './registry.ts';
import type { ApiRoute } from './route.ts';

/** Dataset releases and catalog (SPEC M5). Part of API_ROUTES. */
export const DATASET_ROUTES = {
  listImporters: {
    method: 'get',
    path: '/v1/importers',
    summary: 'Importers (tool output → dataset kind)',
    response: ImporterListSchema,
  },
  startImport: {
    method: 'post',
    path: '/v1/imports',
    summary: 'Import a QC-passed file into a staged release (rejected when a quality rule fails)',
    body: StartImportBodySchema,
    response: ReleaseDetailSchema,
    status: 201,
    reason: true,
  },
  listDatasets: {
    method: 'get',
    path: '/v1/datasets',
    summary: 'Dataset catalog (programs the caller can read)',
    query: ListDatasetsQuerySchema,
    response: DatasetListSchema,
  },
  getDataset: {
    method: 'get',
    path: '/v1/datasets/{id}',
    summary: 'A dataset with its releases',
    response: DatasetDetailSchema,
  },
  getRelease: {
    method: 'get',
    path: '/v1/releases/{id}',
    summary: 'A release: contract, column stats, validation, transformations, source and lineage',
    response: ReleaseDetailSchema,
  },
  previewRelease: {
    method: 'get',
    path: '/v1/releases/{id}/preview',
    summary: 'First rows of a release, read by DuckDB',
    query: PreviewQuerySchema,
    response: ReleasePreviewSchema,
  },
  publishRelease: {
    method: 'post',
    path: '/v1/releases/{id}/publish',
    summary: 'Publish a staged release (reason required; immutable afterwards)',
    body: ReleaseReasonBodySchema,
    response: ReleaseDetailSchema,
  },
  rejectRelease: {
    method: 'post',
    path: '/v1/releases/{id}/reject',
    summary: 'Reject a staged release (reason required)',
    body: ReleaseReasonBodySchema,
    response: ReleaseDetailSchema,
  },
  getOdcsContract: {
    method: 'get',
    path: '/v1/contracts/{kind}/odcs',
    summary: 'Open Data Contract Standard (ODCS v3) YAML for a dataset kind',
  },
  listImportPresets: {
    method: 'get',
    path: '/v1/programs/{id}/import-presets',
    summary: 'Saved custom_tabular column mappings of a program',
    response: ItemsSchema(ImportPresetSchema),
  },
  createImportPreset: {
    method: 'post',
    path: '/v1/programs/{id}/import-presets',
    summary: 'Save a custom_tabular column mapping (same name updates it)',
    body: ImportPresetBodySchema,
    response: ImportPresetSchema,
    status: 201,
  },
} as const satisfies Record<string, ApiRoute>;
