import {
  ImportInteractionsBodySchema,
  InteractionCollectionListSchema,
  InteractionCollectionSchema,
  InteractionNetworkBodySchema,
  InteractionNetworkSchema,
} from './interactions.ts';
import type { ApiRoute } from './route.ts';

/** Interaction collections and networks of hits (Phase 45). Part of API_ROUTES. */
export const INTERACTION_ROUTES = {
  listInteractionCollections: {
    method: 'get',
    path: '/v1/interaction-collections',
    summary: 'Interaction collections available for networks',
    response: InteractionCollectionListSchema,
  },
  importInteractions: {
    method: 'post',
    path: '/v1/interaction-collections',
    summary: 'Import an interaction collection from "a, b, score" text (system admin)',
    body: ImportInteractionsBodySchema,
    response: InteractionCollectionSchema,
    status: 201,
    reason: true,
  },
  interactionNetwork: {
    method: 'post',
    path: '/v1/interactions/network',
    summary: 'Interactions between a contrast’s hits, from an interaction collection',
    body: InteractionNetworkBodySchema,
    response: InteractionNetworkSchema,
  },
} as const satisfies Record<string, ApiRoute>;
