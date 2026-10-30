# msstats_comparison — MSstats groupComparison → differential_abundance

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
MSstats `man/groupComparison.Rd` (Vitek-Lab/MSstats devel 4.21.1, Artistic-2.0, read 2026-10-30), ComparisonResult.

## Columns read
| Column | Docs | Canonical |
|---|---|---|
| Protein | "name of the protein" | feature_id, protein_ids (split on ";") |
| Label | "label of the comparison" | contrast: matched to a registered contrast label, or via options.label_map |
| log2FC | log fold change; base given by `log_base` (options.log_base, default 2; base 10 converted, recorded). Inf / -Inf when one condition is entirely missing | log2_fc |
| SE / Tvalue / DF | standard error / t / degrees of freedom; NA when variance cannot be estimated | se / t_stat / — |
| pvalue / adj.pvalue | p / "adjusted p-value using the Benjamini-Hochberg method" | p_value / adj_p_value, adj_method BH |
| issue | "oneConditionMissing" etc. | issue |
| MissingPercentage / ImputationPercentage | "percentage (between 0 and 1)" | missing_pct / imputed_pct × 100 (recorded) |
na_reason: issue = oneConditionMissing → "MSstats: one condition missing"; DF = 0 → "MSstats: too few
observations (DF = 0)"; SE NA → "MSstats: variance not estimable". Labels not in the registry fail
`contrast_in_registry`.
