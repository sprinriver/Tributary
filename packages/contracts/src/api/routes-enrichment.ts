import {
  EnrichmentBodySchema,
  EnrichmentResponseSchema,
  GeneSetCollectionListSchema,
  GeneSetCollectionSchema,
  ImportGeneSetsBodySchema,
} from './enrichment.ts';
import type { ApiRoute } from './route.ts';

/** Gene-set collections and pathway enrichment (Phase 24). Part of API_ROUTES. */
export const ENRICHMENT_ROUTES = {
  listGeneSetCollections: {
    method: 'get',
    path: '/v1/gene-set-collections',
    summary: 'Gene-set collections available for enrichment',
    response: GeneSetCollectionListSchema,
  },
  importGeneSets: {
    method: 'post',
    path: '/v1/gene-set-collections',
    summary: 'Import a gene-set collection from GMT text (system admin)',
    body: ImportGeneSetsBodySchema,
    response: GeneSetCollectionSchema,
    status: 201,
    reason: true,
  },
  runEnrichment: {
    method: 'post',
    path: '/v1/enrichment',
    summary: 'Over-representation analysis of a contrast’s hits against a gene-set collection',
    body: EnrichmentBodySchema,
    response: EnrichmentResponseSchema,
  },
} as const satisfies Record<string, ApiRoute>;
