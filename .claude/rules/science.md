---
paths:
  - "apps/compute/**"
  - "packages/importers/**"
  - "apps/query/src/**"
  - "apps/web/src/charts/**"
  - "packages/contracts/src/datasets/**"
---
# Science rules (see also CLAUDE.md "Science conventions")
- Cite the source of every formula or column meaning in a comment: tool docs URL + version, or paper DOI.
- Statistics live in apps/compute (Python). TypeScript does only pseudolog, z-score, binning, BH and error bars.
- Guard before computing: ≥ 2 samples for clustering, ≥ 2 distinct values for KDE, ≥ 4 dose levels for curve
  fits, finite p in (0, 1], no all-NaN rows. Return `{code, field, message}`.
- Seed every stochastic step (bootstrap, randomised solvers) and record the seed.
- Record every transformation in the dataset release or chart provenance.
- Use the omics-reviewer subagent before finishing work in these paths.
