import { ProteinModelSchema } from './protein-model.ts';
import type { ApiRoute } from './route.ts';

/** 3D models of proteins (Phase 29). Part of API_ROUTES. */
export const PROTEIN_MODEL_ROUTES = {
  getProteinModel: {
    method: 'get',
    path: '/v1/proteins/{id}/model',
    summary:
      'Where the 3D model of a protein comes from (local directory or AlphaFold DB), and its confidence metric',
    response: ProteinModelSchema,
  },
  getProteinModelFile: {
    method: 'get',
    path: '/v1/proteins/{id}/model.cif',
    summary: 'The 3D model as mmCIF (served from the same origin; AlphaFold DB files are fetched by the API)',
  },
} as const satisfies Record<string, ApiRoute>;
