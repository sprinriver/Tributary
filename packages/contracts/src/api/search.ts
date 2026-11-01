import { z } from 'zod';

/** A facet filter: one value or several (`?assay_type=rnaseq&assay_type=crispr_screen`). */
const Multi = z.union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).max(20)]);

export const SEARCH_TYPES = ['experiment', 'sample'] as const;
export const SEARCH_FACETS = ['assay_type', 'program', 'species', 'compound', 'status'] as const;
export type SearchFacet = (typeof SEARCH_FACETS)[number];

/** GET /v1/search (SPEC M9). Free text over every field flagged searchable, plus facets. */
export const SearchQuerySchema = z
  .object({
    q: z.string().trim().min(1, 'Type something to search for.').max(200),
    type: z.enum(SEARCH_TYPES).optional(),
    assay_type: Multi.optional(),
    program_id: Multi.optional(),
    species: Multi.optional(),
    compound: Multi.optional(),
    status: Multi.optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    cursor: z.string().max(200).optional(),
  })
  .meta({ id: 'SearchQuery' });
export type SearchQuery = z.input<typeof SearchQuerySchema>;

export const SearchHitSchema = z
  .object({
    type: z.enum(SEARCH_TYPES),
    /** The experiment version id (type experiment) or sample id (type sample). */
    id: z.uuid(),
    experiment_id: z.uuid(),
    experiment_version_id: z.uuid(),
    experiment_name: z.string(),
    program_id: z.uuid(),
    program_code: z.string(),
    assay_type: z.string(),
    status: z.string(),
    title: z.string(),
    subtitle: z.string(),
    /** Plain text; matched words are wrapped in \u0001…\u0002 for the UI to highlight (never HTML). */
    snippet: z.string(),
    /** Fused score (reciprocal rank fusion) or the full-text rank score when no embeddings are used. */
    score: z.number(),
    /** 1-based rank of this hit in each sub-query, or null when that sub-query did not return it. */
    ranks: z.object({ fulltext: z.int().nullable(), vector: z.int().nullable() }),
  })
  .meta({ id: 'SearchHit' });
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const FacetValueSchema = z.object({ value: z.string(), label: z.string(), count: z.int() });
export type FacetValue = z.infer<typeof FacetValueSchema>;

export const SearchResponseSchema = z
  .object({
    items: z.array(SearchHitSchema),
    /** Counts over the matching set (query, type, the caller's programs) before facet filters. */
    facets: z.object(
      Object.fromEntries(SEARCH_FACETS.map((f) => [f, z.array(FacetValueSchema)])),
    ) as z.ZodObject<Record<SearchFacet, z.ZodArray<typeof FacetValueSchema>>>,
    /** Hits after facet filters. */
    total: z.int(),
    /** `fulltext` when no provider is configured, or when the embedding call failed for this query. */
    mode: z.enum(['fulltext', 'hybrid']),
    /** True when the candidate cap was reached: `total` and facet counts are then lower bounds. */
    capped: z.boolean(),
    /** Ontology terms whose synonyms matched words of the query; their labels were searched too. */
    expansions: z.array(z.object({ term_id: z.string(), label: z.string(), matched: z.string() })),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'SearchResponse' });
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const ReindexResponseSchema = z
  .object({
    documents: z.int(),
    embedded: z.int(),
    provider: z.enum(['none', 'bedrock_titan_v2', 'voyage_4', 'local']),
  })
  .meta({ id: 'SearchReindexResponse' });
export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;

/** apps/compute POST /embed (the `local` provider). */
export const EmbedRequestSchema = z
  .object({
    texts: z.array(z.string().max(20_000)).min(1).max(256),
    dims: z.int().min(8).max(1024),
  })
  .meta({ id: 'EmbedRequest' });
export const EmbedResponseSchema = z
  .object({ model: z.string(), dims: z.int(), embeddings: z.array(z.array(z.number())) })
  .meta({ id: 'EmbedResponse' });
export type EmbedResponse = z.infer<typeof EmbedResponseSchema>;
