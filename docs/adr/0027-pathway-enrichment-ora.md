# 0027 — Pathway enrichment: over-representation analysis on the tested features
Date: 2026-11-03 · Status: accepted
## Context
- **The need:** after a volcano, scientists ask "which pathways?", and today they leave the platform to answer it.
- **What others do:** Perseus, g:Profiler, STRING and clusterProfiler offer ORA and GSEA. We take the ideas only; no
  code or data is copied.
- **Constraints:**
  - statistics live in apps/compute;
  - no GPL dependencies;
  - nothing is filtered or transformed silently;
  - gene-set licences must allow redistribution. GO is CC BY 4.0 and Reactome is CC0. MSigDB's licence restricts
    use, so it is not bundled or recommended.
## Decision
- **Method:** over-representation analysis (ORA), the one-sided hypergeometric P(X ≥ k) per set (Rivals et al.
  2007). Benjamini–Hochberg adjustment runs across the sets actually tested. GSEA (rank-based) is deferred.
- **Universe:** by default, every identifier the source tool tested in that contrast. Rows without an adjusted p or a
  fold change are excluded and counted. An `annotated` option keeps only identifiers that are in at least one set,
  which is the clusterProfiler convention.
- **Hits:** the source tool's adjusted p ≤ threshold, then a post-hoc |log2 FC| threshold with a strict sign test for
  up or down.
- **Identifiers:**
  - Protein groups are expanded to each gene symbol or accession they contain.
  - Multi-identifier hit groups, and identifiers that are a hit in one group but not in another, are counted in
    provenance.
  - UniProt isoform suffixes are stripped. Gene symbols are never case-folded, because case differs between
    species.
  - The experiment's species must match the collection's.
- **Collections:** gene-set collections are imported from GMT by a system admin and audited. Each is immutable, and
  a newer source release becomes a new collection.
- **Display:** the dot plot (Plotly figure from the API) plots −log10 of the term adjusted p, with the reference line
  at term FDR 0.05. The feature hit threshold is a separate caption.
- **Numerics:** p-values come from the log survival function and are floored at the smallest positive double, so they
  stay in (0, 1].
## Consequences
- Results are reproducible from the provenance: release, contrast, collection, source release, thresholds,
  universe, counts and compute version.
- **Not included:** GSEA, redundancy reduction (for example GO-term semantic similarity) and network views are
  follow-ups. Customers import their own GO or Reactome GMT.
## Revisit when
Users need rank-based tests (no threshold), or collections with tens of thousands of sets.
