import {
  CompoundSearchBodySchema,
  CompoundStructureQuerySchema,
  CompoundSearchResponseSchema,
  CompoundStructureSchema,
} from './chem.ts';
import {
  SelectivityQuerySchema,
  SelectivityResponseSchema,
  SelectivityTableQuerySchema,
  SelectivityTableSchema,
} from './selectivity.ts';
import type { ApiRoute } from './route.ts';

/** Compound structures and structure search (Phase 28). Part of API_ROUTES. */
export const CHEM_ROUTES = {
  getCompoundStructure: {
    method: 'get',
    path: '/v1/compounds/{id}/structure',
    summary: 'Depiction, canonical SMILES, InChIKey and descriptors of a compound batch (RDKit)',
    query: CompoundStructureQuerySchema,
    response: CompoundStructureSchema,
  },
  getCompoundSelectivity: {
    method: 'get',
    path: '/v1/compounds/{id}/selectivity',
    summary:
      'Selectivity profile of a compound in one profiling experiment: proteins tested and engaged, S(x), selectivity window',
    query: SelectivityQuerySchema,
    response: SelectivityResponseSchema,
  },
  listSelectivity: {
    method: 'get',
    path: '/v1/selectivity',
    summary: 'Selectivity of every profiled compound: one row per compound and readable profiling dataset',
    query: SelectivityTableQuerySchema,
    response: SelectivityTableSchema,
  },
  searchCompounds: {
    method: 'post',
    path: '/v1/compounds/search',
    summary:
      'Substructure (SMARTS) or similarity (Morgan fingerprint, Tanimoto) search of readable compounds',
    body: CompoundSearchBodySchema,
    response: CompoundSearchResponseSchema,
  },
} as const satisfies Record<string, ApiRoute>;
