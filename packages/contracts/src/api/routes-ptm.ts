import {
  EvidenceMatrixQuerySchema,
  EvidenceMatrixSchema,
  TargetEvidenceQuerySchema,
  TargetEvidenceSchema,
} from './evidence.ts';
import {
  ProteinSitesQuerySchema,
  ProteinSitesSchema,
  SiteSummaryQuerySchema,
  SiteSummarySchema,
} from './ptm.ts';
import type { ApiRoute } from './route.ts';

/** Modification sites (Phase 47) and compound target evidence (Phase 49). Part of API_ROUTES. */
export const PTM_ROUTES = {
  getProteinSites: {
    method: 'get',
    path: '/v1/proteins/{id}/sites',
    summary: 'Modification sites of a protein across readable site releases, with a site map',
    query: ProteinSitesQuerySchema,
    response: ProteinSitesSchema,
  },
  getSiteSummary: {
    method: 'get',
    path: '/v1/ptm-sites/summary',
    summary: 'Sites, sites meeting a localisation threshold and sites per sample in one site release',
    query: SiteSummaryQuerySchema,
    response: SiteSummarySchema,
  },
  getTargetEvidence: {
    method: 'get',
    path: '/v1/compounds/{id}/target-evidence',
    summary:
      'Per protein, the dose-response, thermal-shift and annotation evidence for a compound within one program',
    query: TargetEvidenceQuerySchema,
    response: TargetEvidenceSchema,
  },
  getEvidenceMatrix: {
    method: 'get',
    path: '/v1/target-evidence/matrix',
    summary:
      'Compound × protein evidence for one program: the compound page lines per cell; no combined score',
    query: EvidenceMatrixQuerySchema,
    response: EvidenceMatrixSchema,
  },
} as const satisfies Record<string, ApiRoute>;
