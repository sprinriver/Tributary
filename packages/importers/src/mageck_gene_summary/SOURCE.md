# mageck_gene_summary — MAGeCK RRA gene_summary.txt → crispr_gene_summary

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
MAGeCK wiki "Output file specification", gene_summary_txt (sourceforge.net/p/mageck/wiki/output, read 2026-10-30).

## Columns read (wiki wording)
| Column | Meaning | Canonical |
|---|---|---|
| id | Gene ID | gene |
| num | number of targeting sgRNAs | n_guides |
| neg\|score / pos\|score | RRA lo value in negative / positive selection | neg_score / pos_score |
| neg\|p-value / pos\|p-value | raw (permutation) p-value | neg_p / pos_p |
| neg\|fdr / pos\|fdr | false discovery rate | neg_fdr / pos_fdr |
| neg\|rank / pos\|rank | ranking | neg_rank / pos_rank |
| neg\|lfc / pos\|lfc | log2 fold change (method set by --gene-lfc-method) | neg_lfc / pos_lfc |
| neg\|goodsgrna / pos\|goodsgrna | "good" sgRNAs | — (source only) |
The mle subcommand's gene_summary (beta/z/wald columns) is a different format and is not accepted.
