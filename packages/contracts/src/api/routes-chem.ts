import {
  CompoundSearchBodySchema,
  CompoundStructureQuerySchema,
  CompoundSearchResponseSchema,
  CompoundStructureSchema,
} from './chem.ts';
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
  searchCompounds: {
    method: 'post',
    path: '/v1/compounds/search',
    summary:
      'Substructure (SMARTS) or similarity (Morgan fingerprint, Tanimoto) search of readable compounds',
    body: CompoundSearchBodySchema,
    response: CompoundSearchResponseSchema,
  },
} as const satisfies Record<string, ApiRoute>;
