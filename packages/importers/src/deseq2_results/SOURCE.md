# deseq2_results — DESeq2 results → differential_abundance (feature_type gene)

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
DESeq2 `man/results.Rd` and `vignettes/DESeq2.Rmd` "Note on p-values set to NA" (bioc/DESeq2 devel 1.53.6, read
2026-10-30). Expected input: `write.csv(as.data.frame(results(dds, contrast = ...)))` (first header empty).

## Columns read
| Column | Docs | Canonical |
|---|---|---|
| first column (row names) | gene identifier | feature_id |
| baseMean | mean of normalised counts | — (source only; linear scale, not log2) |
| log2FoldChange | log2 fold change | log2_fc |
| lfcSE | "standard error of the log2FoldChange" | se |
| stat | Wald statistic (log2FoldChange / lfcSE); for the LRT a deviance difference | t_stat (Wald; null when options.test = LRT) |
| pvalue / padj | p / adjusted (pAdjustMethod, default "BH") | p_value / adj_p_value |
NA tokens: NA. na_reason (vignette): baseMean = 0 → "DESeq2: all counts zero"; pvalue NA → "DESeq2: count outlier
(Cook's distance)"; only padj NA → "DESeq2: removed by independent filtering".
