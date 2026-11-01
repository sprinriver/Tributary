import { AuditExportQuerySchema, AuditListSchema, AuditQuerySchema } from './audit.ts';
import { LineageGraphSchema, LineageQuerySchema } from './lineage.ts';
import type { ApiRoute } from './route.ts';

/** Lineage, audit log and per-entity history (SPEC M10). Part of API_ROUTES. */
export const TRUST_ROUTES = {
  getLineage: {
    method: 'get',
    path: '/v1/lineage',
    summary: 'Lineage graph around a file, run, release, experiment version or saved chart',
    query: LineageQuerySchema,
    response: LineageGraphSchema,
  },
  listAudit: {
    method: 'get',
    path: '/v1/audit',
    summary: 'Audit log, newest first, with filters (system admin)',
    query: AuditQuerySchema,
    response: AuditListSchema,
  },
  exportAudit: {
    method: 'get',
    path: '/v1/audit/export',
    summary: 'Audit log as CSV with the same filters (system admin; the export is audited)',
    query: AuditExportQuerySchema,
  },
  getHistory: {
    method: 'get',
    path: '/v1/history/{type}/{id}',
    summary: 'Audit history of one entity (experiment includes its versions)',
    response: AuditListSchema,
  },
} as const satisfies Record<string, ApiRoute>;
