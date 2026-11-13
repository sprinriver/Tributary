import { z } from 'zod';
import { EnrichmentHitGeneSchema, GeneSetIdTypeSchema } from './enrichment.ts';

// Interaction collections and the network of a contrast's hits (Phase 45, PPI-02/03).

export const ImportInteractionsBodySchema = z
  .strictObject({
    /** e.g. "STRING human, high confidence". */
    name: z.string().trim().min(1).max(200),
    /** e.g. STRING, or an internal source. */
    source: z.string().trim().min(1).max(100),
    /** The source's version and any threshold applied, e.g. "v12.0, combined score ≥ 0.7". */
    source_release: z.string().trim().min(1).max(100),
    /** NCBITaxon CURIE, e.g. NCBITaxon:9606. */
    species: z.string().regex(/^NCBITaxon:\d+$/, 'An NCBITaxon CURIE, e.g. NCBITaxon:9606'),
    id_type: GeneSetIdTypeSchema,
    /** The source's licence, shown with every network (STRING: "CC BY 4.0"). */
    licence: z.string().trim().min(1).max(200).optional(),
    /** One pair per line: "a<TAB>b<TAB>score", score a whole number from 0 to 1000. */
    interactions: z.string().min(1).max(60_000_000),
  })
  .meta({ id: 'ImportInteractionsBody' });
export type ImportInteractionsBody = z.infer<typeof ImportInteractionsBodySchema>;

export const InteractionCollectionSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    source: z.string(),
    source_release: z.string(),
    species: z.string(),
    id_type: GeneSetIdTypeSchema,
    licence: z.string().nullable(),
    edge_count: z.int(),
    node_count: z.int(),
    created_at: z.string(),
  })
  .meta({ id: 'InteractionCollection' });
export type InteractionCollection = z.infer<typeof InteractionCollectionSchema>;

export const InteractionCollectionListSchema = z
  .object({ items: z.array(InteractionCollectionSchema) })
  .meta({ id: 'InteractionCollectionList' });

export const InteractionNetworkBodySchema = z
  .strictObject({
    /** A differential_abundance release. */
    release_id: z.uuid(),
    /** Required when the release holds more than one contrast. */
    contrast_label: z.string().min(1).max(500).optional(),
    collection_id: z.uuid(),
    /** Hits as in enrichment: up, down, or both directions at the thresholds. */
    direction: z.enum(['up', 'down', 'both']).default('both'),
    adj_p_max: z.number().gt(0).lte(1).default(0.05),
    abs_log2fc_min: z.number().min(0).max(20).default(1),
    /** Edges below this score are left out (STRING: 400 medium, 700 high, 900 highest confidence). */
    min_score: z.int().min(0).max(1000).default(700),
    /** The strongest edges shown. */
    max_edges: z.int().min(1).max(2000).default(500),
  })
  .meta({ id: 'InteractionNetworkBody' });
export type InteractionNetworkBody = z.infer<typeof InteractionNetworkBodySchema>;

export const InteractionNetworkSchema = z
  .object({
    /** Hit identifiers with at least one shown edge. */
    nodes: z.array(EnrichmentHitGeneSchema.extend({ degree: z.int() })),
    /** Undirected edges between two hits (a < b), strongest first. */
    edges: z.array(z.object({ a: z.string(), b: z.string(), score: z.int() })),
    provenance: z.object({
      release_id: z.uuid(),
      contrast_label: z.string(),
      collection: z.object({
        id: z.uuid(),
        name: z.string(),
        source: z.string(),
        source_release: z.string(),
        id_type: GeneSetIdTypeSchema,
        licence: z.string().nullable(),
      }),
      thresholds: z.object({
        direction: z.enum(['up', 'down', 'both']),
        adj_p_max: z.number(),
        abs_log2fc_min: z.number(),
      }),
      min_score: z.int(),
      counts: z.object({
        hits: z.int(),
        hits_in_collection: z.int(),
        hits_not_in_collection: z.int(),
        /** Edges between two hits at the score asked for. */
        edges: z.int(),
        edges_shown: z.int(),
        hits_connected: z.int(),
        hits_without_partner: z.int(),
      }),
      notes: z.array(z.string()),
    }),
  })
  .meta({ id: 'InteractionNetwork' });
export type InteractionNetwork = z.infer<typeof InteractionNetworkSchema>;
