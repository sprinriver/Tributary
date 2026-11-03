import { z } from 'zod';

// Pathway enrichment (Phase 24, ENR-01…04): over-representation analysis (ORA) of a hit list against gene-set
// collections (GO, Reactome, or a customer's own), using the measured features as the background.
// Method: one-sided hypergeometric test per set (Rivals et al. 2007, doi:10.1093/bioinformatics/btl633),
// Benjamini–Hochberg adjustment across the tested sets (doi:10.1111/j.2517-6161.1995.tb02031.x).

const Id = z.string().min(1).max(200);

/** apps/compute /stats/enrichment request. */
export const EnrichmentRequestSchema = z
  .strictObject({
    /** Hit identifiers; every one must be in the background. */
    hits: z.array(Id).min(1).max(100_000),
    /** Every identifier that was measured and tested (the universe). */
    background: z.array(Id).min(1).max(500_000),
    gene_sets: z
      .array(z.strictObject({ id: Id, name: z.string().max(500), members: z.array(Id).min(1).max(50_000) }))
      .min(1)
      .max(100_000),
    /** Sets are tested only when their size within the background is in [min_size, max_size]. */
    min_size: z.int().min(1).max(10_000),
    max_size: z.int().min(1).max(100_000),
  })
  .meta({ id: 'EnrichmentRequest' });
export type EnrichmentRequest = z.infer<typeof EnrichmentRequestSchema>;

export const EnrichmentTermSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Set members in the background (K). */
  size: z.int(),
  /** Hits in the set (k). */
  overlap: z.int(),
  /** k expected by chance: n·K/N. */
  expected: z.number(),
  /** (k/n) / (K/N). */
  fold_enrichment: z.number(),
  /** P(X ≥ k), X ~ Hypergeometric(N, K, n); floored at the smallest positive double. */
  p_value: z.number().gt(0).lte(1),
  adj_p_value: z.number().gt(0).lte(1),
  /** The overlapping hits, sorted. */
  genes: z.array(z.string()),
});
export type EnrichmentTerm = z.infer<typeof EnrichmentTermSchema>;

export const EnrichmentResultSchema = z
  .object({
    /** Tested sets, by p-value then id. */
    terms: z.array(EnrichmentTermSchema),
    n_hits: z.int(),
    n_background: z.int(),
    tested: z.int(),
    excluded_small: z.int(),
    excluded_large: z.int(),
    method: z.string(),
    adj_method: z.string(),
    compute_version: z.string(),
  })
  .meta({ id: 'EnrichmentResult' });
export type EnrichmentResult = z.infer<typeof EnrichmentResultSchema>;
