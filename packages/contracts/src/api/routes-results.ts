import type { ApiRoute } from './route.ts';
import {
  CompareBodySchema,
  CompareOptionsSchema,
  CompareResultSchema,
  CompoundPageSchema,
  ProteinPageSchema,
  ReportExportBodySchema,
  ReportExportSchema,
  VersionResultsSchema,
} from './results.ts';

/** Results pages (SPEC M8). Part of API_ROUTES. */
export const RESULT_ROUTES = {
  getVersionResults: {
    method: 'get',
    path: '/v1/versions/{id}/results',
    summary: 'Results of a version: releases, contrasts, run, files and methods paragraph',
    response: VersionResultsSchema,
  },
  recordReportExport: {
    method: 'post',
    path: '/v1/versions/{id}/report-exports',
    summary: 'Record (and audit) a PDF or PowerPoint export of the version report',
    body: ReportExportBodySchema,
    response: ReportExportSchema,
    status: 201,
  },
  getCompound: {
    method: 'get',
    path: '/v1/compounds/{id}',
    summary: 'Compound page: properties/ADME and the contrasts it was tested in',
    response: CompoundPageSchema,
  },
  getProtein: {
    method: 'get',
    path: '/v1/proteins/{id}',
    summary: 'Protein page: reference annotations',
    response: ProteinPageSchema,
  },
  listCompareOptions: {
    method: 'get',
    path: '/v1/compare/options',
    summary: 'Contrasts with published differential-abundance releases',
    response: CompareOptionsSchema,
  },
  compareContrasts: {
    method: 'post',
    path: '/v1/compare',
    summary: 'Compare 2–6 contrasts: log2 FC scatter, overlap and intersections',
    body: CompareBodySchema,
    response: CompareResultSchema,
  },
} as const satisfies Record<string, ApiRoute>;
