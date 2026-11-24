import { z } from 'zod';
import { EnrichmentTermSchema } from '../enrichment.ts';

// Gene-set collections and pathway enrichment over a differential-abundance release (Phase 24, ENR-02/03).

export const GeneSetIdTypeSchema = z.enum(['gene_symbol', 'uniprot_accession']);

export const ImportGeneSetsBodySchema = z
  .strictObject({
    /** e.g. "Reactome pathways (human)". */
    name: z.string().trim().min(1).max(200),
    /** e.g. Reactome, GO:BP, or an internal source. */
    source: z.string().trim().min(1).max(100),
    /** The source's version, e.g. "Reactome 94" or a GO release date. */
    source_release: z.string().trim().min(1).max(100),
    /** NCBITaxon CURIE, e.g. NCBITaxon:9606. */
    species: z.string().regex(/^NCBITaxon:\d+$/, 'An NCBITaxon CURIE, e.g. NCBITaxon:9606'),
    id_type: GeneSetIdTypeSchema,
    /** GMT text: one set per line, "id<TAB>description<TAB>member<TAB>member…". */
    gmt: z.string().min(1).max(50_000_000),
  })
  .meta({ id: 'ImportGeneSetsBody' });
export type ImportGeneSetsBody = z.infer<typeof ImportGeneSetsBodySchema>;

export const GeneSetCollectionSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    source: z.string(),
    source_release: z.string(),
    species: z.string(),
    id_type: GeneSetIdTypeSchema,
    set_count: z.int(),
    member_count: z.int(),
    created_at: z.string(),
  })
  .meta({ id: 'GeneSetCollection' });
export type GeneSetCollection = z.infer<typeof GeneSetCollectionSchema>;

export const GeneSetCollectionListSchema = z
  .object({ items: z.array(GeneSetCollectionSchema) })
  .meta({ id: 'GeneSetCollectionList' });

export const EnrichmentBodySchema = z
  .strictObject({
    /** A differential_abundance release. */
    release_id: z.uuid(),
    /** Required when the release holds more than one contrast ("numerator vs denominator"). */
    contrast_label: z.string().min(1).max(500).optional(),
    collection_id: z.uuid(),
    /** up: log2 fold change ≥ threshold; down: ≤ −threshold; both: |log2 fold change| ≥ threshold. */
    direction: z.enum(['up', 'down', 'both']).default('both'),
    adj_p_max: z.number().gt(0).lte(1).default(0.05),
    abs_log2fc_min: z.number().min(0).max(20).default(1),
    min_size: z.int().min(1).max(10_000).default(10),
    max_size: z.int().min(1).max(100_000).default(500),
    /**
     * measured: every tested identifier is in the universe. annotated: only tested identifiers that are in at least
     * one set of the collection (the convention of e.g. clusterProfiler; changes N, n and fold enrichment).
     */
    universe: z.enum(['measured', 'annotated']).default('measured'),
  })
  .meta({ id: 'EnrichmentBody' });
export type EnrichmentBody = z.infer<typeof EnrichmentBodySchema>;

export const EnrichmentHitGeneSchema = z.object({
  id: z.string(),
  /** log2(numerator / denominator) when the identifier is a hit in one feature; null when in several. */
  log2_fc: z.number().nullable(),
  /** Hit features (rows) holding this identifier. */
  features: z.int(),
  /** Sign of its fold changes: all up, all down, or mixed. */
  direction: z.enum(['up', 'down', 'mixed']),
});
export type EnrichmentHitGene = z.infer<typeof EnrichmentHitGeneSchema>;

export const EnrichmentResponseSchema = z
  .object({
    terms: z.array(EnrichmentTermSchema),
    /** Every hit identifier tested (in the universe), for the gene–concept network. */
    hit_genes: z.array(EnrichmentHitGeneSchema),
    /** Dot plot of the top terms (Plotly figure JSON; the page renders it, it computes nothing). */
    figure: z.object({
      data: z.array(z.record(z.string(), z.unknown())),
      layout: z.record(z.string(), z.unknown()),
    }),
    provenance: z.object({
      release_id: z.uuid(),
      contrast_label: z.string(),
      collection: z.object({
        id: z.uuid(),
        name: z.string(),
        source: z.string(),
        source_release: z.string(),
        id_type: GeneSetIdTypeSchema,
      }),
      thresholds: z.object({
        direction: z.enum(['up', 'down', 'both']),
        adj_p_max: z.number(),
        abs_log2fc_min: z.number(),
        min_size: z.int(),
        max_size: z.int(),
        /** Term-level FDR drawn as the reference line of the dot plot. */
        term_fdr: z.number(),
      }),
      /** Rows of the contrast, and how many of them were hits. */
      features: z.int(),
      hit_features: z.int(),
      /** Features without an identifier of the collection's type (left out of the universe). */
      features_without_ids: z.int(),
      /** Features without an adjusted p or fold change (not tested by the source tool; left out of the universe). */
      untested_features: z.int(),
      /** Hit features holding more than one identifier (e.g. a protein group of paralogs). */
      multi_id_hit_features: z.int(),
      /** Identifiers that are a hit in one feature and not a hit in another (counted as hits). */
      conflicting_ids: z.int(),
      universe: z.enum(['measured', 'annotated']),
      /** Tested identifiers that are in at least one set of the collection. */
      background_annotated: z.int(),
      /** The source tool's adjustment method(s) for the adjusted p used to pick hits. */
      source_adj_methods: z.array(z.string()),
      /** Distinct identifiers after expanding protein groups (N and n of the test). */
      background: z.int(),
      hits: z.int(),
      tested: z.int(),
      excluded_small: z.int(),
      excluded_large: z.int(),
      method: z.string(),
      adj_method: z.string(),
      transformations: z.array(z.string()),
      compute_version: z.string(),
    }),
  })
  .meta({ id: 'EnrichmentResponse' });
export type EnrichmentResponse = z.infer<typeof EnrichmentResponseSchema>;
