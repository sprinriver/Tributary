# limma_toptable — limma topTable → differential_abundance

Status: written by Claude in Phase 8; awaiting the owner's review.

## Source
- limma `topTable` reference (`man/toptable.Rd`, limma 3.99.3, Bioconductor devel, via the `bioc/limma` GitHub
  mirror, read 2026-10-30), and `R/toptable.R` for the exact output column names (read only; limma is GPL —
  no code copied).
- Expected input: `write.table(topTable(fit, coef = <one contrast>, number = Inf, confint = TRUE), sep = "\t",
  row.names = TRUE, col.names = NA)` (row names become the first column), or a table with an `ID` /
  genelist column, e.g. from nf-core/differentialabundance or custom R. A table whose first column is a statistic
  (identifiers not written) is refused.

## Columns read
| Column | Meaning (limma docs) | Canonical column |
|---|---|---|
| `ID` (or the first column when `ID` is absent and the first column is not a statistic) | probe/feature identifier; "duplicated row names are preserved in the ID column" | `feature_id`; `protein_ids` (split on `;`) when `feature_type = protein_group` |
| `Genes` / `Gene` / `gene_names` (optional genelist column) | annotation | `gene_names` (split on `;`; absent → `[]`) |
| `logFC` | "estimate of the log2-fold-change corresponding to the effect or contrast" | `log2_fc` (log2(numerator / denominator) for the contrast given at import) |
| `CI.L`, `CI.R` | "left/right limit of confidence interval for logFC" (`confint = TRUE`; 95 % by default) | `ci_low`, `ci_high` |
| `AveExpr` | "average log2-expression for the probe over all arrays and channels" | `avg_log2_abundance` |
| `t` | "moderated t-statistic" | `t_stat` |
| `P.Value` | "raw p-value" | `p_value` |
| `adj.P.Val` | "adjusted p-value or q-value"; `adjust.method = "BH"` by default | `adj_p_value`; `adj_method = BH` unless `options.adj_method` says otherwise |
| `B` | "log-odds that the gene is differentially expressed" | — (kept in `source.original_columns`) |

Not imported: `F`. Multi-coefficient tables have no `logFC` column and fail detection; one contrast per file.

## Feature type and contrast
`feature_type` is `protein_group` unless the caller says `gene`; when defaulted this is recorded as a
transformation, and a warn rule (`protein_ids_accessions`) flags IDs that are not UniProt accessions. The contrast is
always chosen explicitly at import (never inferred), because its label fixes the sign of logFC.

## Missing values
NA tokens: `NA`, empty string (R `write.table` default for missing values is `NA`). A null `p_value` gets
`na_reason = "NA in topTable output"`. Nothing is imputed or filtered.

## Not provided by topTable
`se` (derivable as logFC / t for the moderated t, but not derived here — statistics are not computed in
importers), `n_obs_num`, `n_obs_den`,
`missing_pct`, `imputed_pct`, `missingness_class` → null.

## Locale
Decimal-comma exports (`write.csv2` style) are detected when numeric columns use `,` as the decimal mark and are
converted; the conversion is recorded as a transformation.

## Versions
topTable output has carried these names across limma 3.x; `adj.P.Val` (not the Rd's `adj.P.Value`) is what
`R/toptable.R` writes. The limma version is recorded from `options.tool_version`, else `unknown`.
