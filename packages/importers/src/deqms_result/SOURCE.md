# deqms_result — DEqMS outputResult → differential_abundance

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
DEqMS `man/outputResult.Rd` (bioc/DEqMS devel 1.31.0, read 2026-10-30): the limma topTable columns plus
"sca.t - Peptide or Spectra Count Adjusted posterior t-value", "sca.P.Value - Adjusted posterior p-value",
"sca.adj - sca.P.Value adjusted by BH method", and `gene` / `count` from the example.

## Mapping
feature_id = gene (row names), protein_ids split on ";" (feature_type protein_group unless options say gene).
log2_fc = logFC, avg_log2_abundance = AveExpr, t_stat = sca.t, p_value = sca.P.Value, adj_p_value = sca.adj,
adj_method BH, method DEqMS. limma's t / P.Value / adj.P.Val / B are kept in source columns only.
The contrast is chosen explicitly at import.
