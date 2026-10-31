import { z } from 'zod';

// apps/api → apps/compute statistics requests (ARCHITECTURE §7). Generated as pydantic models for the service.
// Guards and errors follow .claude/rules/science.md; failures are 422 with a ContractError `{code, field, message}`.

/** Hierarchical clustering methods (v1 parity, REFERENCE_V1 §7). `ward.D2` = Ward on Euclidean distances;
 * `weighted` = WPGMA (R hclust "mcquitty"). */
export const CLUSTER_METHODS = [
  'average',
  'single',
  'complete',
  'weighted',
  'centroid',
  'median',
  'ward.D2',
] as const;
/** Distance metrics (v1 parity). `maximum` = Chebyshev; `manhattan` = city block; `correlation` = 1 − Pearson r. */
export const DISTANCE_METRICS = [
  'euclidean',
  'manhattan',
  'maximum',
  'canberra',
  'cosine',
  'correlation',
] as const;
/** Methods defined only for Euclidean distances (their update formulas assume them). */
export const EUCLIDEAN_ONLY_METHODS: readonly string[] = ['centroid', 'median', 'ward.D2'];

const Matrix = z.array(z.array(z.number().nullable()).min(1)).min(1);

export const ClusterRequestSchema = z
  .strictObject({
    /** rows × columns; null = missing (rejected: no silent imputation). */
    values: Matrix,
    row_labels: z.array(z.string()).min(1),
    column_labels: z.array(z.string()).min(1),
    axis: z.enum(['rows', 'columns', 'both']),
    method: z.enum(CLUSTER_METHODS),
    metric: z.enum(DISTANCE_METRICS),
    /** `optimal` reorders leaves to minimise adjacent distances (Bar-Joseph et al. 2001). */
    leaf_ordering: z.enum(['default', 'optimal']),
    /** Bootstrap iterations over the other axis (0 = none). */
    bootstrap_n: z.int().min(0).max(1000),
    seed: z.int().min(0),
  })
  .meta({ id: 'ClusterRequest' });
export type ClusterRequest = z.infer<typeof ClusterRequestSchema>;

export const ClusterTreeSchema = z
  .object({
    /** Leaf order (indices into the axis). */
    order: z.array(z.int()),
    /** SciPy linkage matrix: [left, right, height, size] per merge. */
    linkage: z.array(z.array(z.number()).length(4)),
    /** Bootstrap support per merge (fraction of resamples with the same clade); null without bootstrap. */
    support: z.array(z.number()).nullable(),
    /** Resamples that produced a tree (support is a share of these); null without bootstrap. */
    bootstrap_valid: z.int().nullable(),
  })
  .meta({ id: 'ClusterTree' });

export const ClusterResultSchema = z
  .object({
    rows: ClusterTreeSchema.nullable(),
    columns: ClusterTreeSchema.nullable(),
    seed: z.int(),
    method: z.string(),
    metric: z.string(),
    compute_version: z.string(),
  })
  .meta({ id: 'ClusterResult' });
export type ClusterResult = z.infer<typeof ClusterResultSchema>;

export const KdeRequestSchema = z
  .strictObject({
    values: z.array(z.number()).min(1),
    points: z.int().min(16).max(2048),
    bandwidth: z.enum(['scott', 'silverman']),
  })
  .meta({ id: 'KdeRequest' });
export const KdeResultSchema = z
  .object({
    x: z.array(z.number()),
    density: z.array(z.number()),
    bandwidth: z.number(),
    compute_version: z.string(),
  })
  .meta({ id: 'KdeResult' });

export const PValuesRequestSchema = z
  .strictObject({
    p_values: z.array(z.number().nullable()).min(1),
    /** BH = Benjamini–Hochberg (1995), BY = Benjamini–Yekutieli (2001). */
    method: z.enum(['BH', 'BY']),
  })
  .meta({ id: 'PValuesRequest' });
export const PValuesResultSchema = z
  .object({ adjusted: z.array(z.number().nullable()), method: z.string(), compute_version: z.string() })
  .meta({ id: 'PValuesResult' });

export const ZScoreRequestSchema = z
  .strictObject({ values: Matrix, axis: z.enum(['rows', 'columns']) })
  .meta({ id: 'ZScoreRequest' });
export const ZScoreResultSchema = z
  .object({ values: z.array(z.array(z.number().nullable())), compute_version: z.string() })
  .meta({ id: 'ZScoreResult' });

export const PcaRequestSchema = z
  .strictObject({
    /** samples × features. */
    values: Matrix,
    scale: z.boolean(),
    components: z.int().min(1).max(10),
  })
  .meta({ id: 'PcaRequest' });
export const PcaResultSchema = z
  .object({
    scores: z.array(z.array(z.number())),
    loadings: z.array(z.array(z.number())),
    explained_variance_ratio: z.array(z.number()),
    compute_version: z.string(),
  })
  .meta({ id: 'PcaResult' });

export const Fit4plRequestSchema = z
  .strictObject({
    /** Doses in molar (SI), > 0. */
    doses_molar: z.array(z.number()).min(1),
    responses: z.array(z.number()).min(1),
  })
  .meta({ id: 'Fit4plRequest' });
export const Fit4plResultSchema = z
  .object({
    top: z.number(),
    bottom: z.number(),
    ec50_molar: z.number(),
    /** −log10(EC50 in M). */
    pec50: z.number(),
    /** > 0: the response falls with dose. Reported with top ≥ bottom. */
    hill_slope: z.number(),
    r2: z.number(),
    /** False when the fitted EC50 lies outside the tested doses (extrapolated). */
    ec50_in_range: z.boolean(),
    compute_version: z.string(),
  })
  .meta({ id: 'Fit4plResult' });

const Groups = z
  .array(z.strictObject({ name: z.string(), values: z.array(z.number()) }))
  .min(1)
  .max(200);

export const GroupTestRequestSchema = z
  .strictObject({
    groups: Groups,
    /** Pairwise against the first group (BH-adjusted): welch_t, mann_whitney, ks. Overall: anova, kruskal. */
    method: z.enum(['welch_t', 'mann_whitney', 'ks', 'anova', 'kruskal']),
  })
  .meta({ id: 'GroupTestRequest' });
export const GroupTestResultSchema = z
  .object({
    method: z.string(),
    overall_p: z.number().nullable(),
    comparisons: z.array(
      z.object({ group: z.string(), reference: z.string(), p: z.number(), p_adj: z.number() }),
    ),
    adj_method: z.string(),
    compute_version: z.string(),
  })
  .meta({ id: 'GroupTestResult' });
export type GroupTestResult = z.infer<typeof GroupTestResultSchema>;

export const GroupSummaryRequestSchema = z
  .strictObject({ groups: Groups })
  .meta({ id: 'GroupSummaryRequest' });
export const GroupSummaryResultSchema = z
  .object({
    groups: z.array(
      z.object({
        name: z.string(),
        n: z.int(),
        mean: z.number().nullable(),
        /** Sample SD (n − 1); null for n < 2. */
        sd: z.number().nullable(),
        sem: z.number().nullable(),
        /** Half-width of the 95% t interval of the mean. */
        ci95: z.number().nullable(),
        median: z.number().nullable(),
        /** sd / mean (null when mean is 0 or n < 2). */
        cv: z.number().nullable(),
      }),
    ),
    compute_version: z.string(),
  })
  .meta({ id: 'GroupSummaryResult' });
export type GroupSummaryResult = z.infer<typeof GroupSummaryResultSchema>;
