# tpp_tr — TPP-TR results table → thermal_shift

Status: written by Claude in Phase 46; awaiting the owner's review. The owner delegated product decisions on
2026-11-13, so the importer is built against this file without stopping, as was done for curvecurator.

## Source
Bioconductor package TPP 3.40.2 (Artistic-2.0; source tarball from bioconductor.org, read 2026-11-13). Only the
output format and the documented definitions were read; no code is copied and the tool is never run.
- `R/retrieveDataFromESets_TR.R`, `R/mergeOutputTables_TR.R`: how the result table of `analyzeTPPTR` is assembled.
- `R/meltCurveParamNames.R`, `R/paramsSigmoid.R`, `R/fctSigmoidTR.R`, `R/meltingCurveSlope.R`: curve parameters.
- `R/pValFct_addMPdiff_and_MinSlope_Columns.R`, `R/computeMPdiffs.R`, `R/computeMinimalSlopes.R`,
  `R/pValFctFilterModels.R`, `R/pValFctPerformSingleComparison.R`, `R/computePvalues.R`: comparisons and p-values.
- `R/checkResultCols_tpptr.R`: the quality-check columns.
- `data/hdacTR_resultsTable_smallExample.RData`: the column names of a real result table (listed below).
- `man/tpptrImport.Rd`: fold changes are relative to the lowest temperature.

## Input file
`analyzeTPPTR` returns a data frame and saves it as an Excel workbook. This importer reads that table as
tab-separated text (for example `write.table(TRresults, "tr.tsv", sep = "\t", quote = FALSE, row.names = FALSE)`).
R writes missing values as `NA` and booleans as `TRUE` / `FALSE`.

One row per protein. `<E>` is an experiment name from the user's TPP config table (e.g. `Vehicle_1`,
`Panobinostat_1`); `<T>_vs_<V>` is a comparison of a treatment experiment with a vehicle experiment.

| Column | Meaning (from the source above) |
|---|---|
| `Protein_ID` | The identifier column of the input files (the package default `idVar` is `gene_name`, so it is often a gene symbol). |
| `rel_fc_<label>_<E>` or `norm_rel_fc_<label>_<E>` | Fold change of the isobaric label `<label>` (e.g. `126`, `127L`) in experiment `<E>`, relative to the lowest temperature. The `norm_` prefix is present when the data were normalised. |
| `meltPoint_<E>` | Melting point: the temperature at which the fitted curve equals 0.5. Units: as the temperatures in the config table (°C). |
| `inflPoint_<E>` | Temperature of the curve's inflection point. |
| `slope_<E>` | Slope of the fitted curve at the inflection point (per °C; negative for a melting protein). |
| `plateau_<E>` | The fitted lower plateau `Pl`. |
| `R_sq_<E>` | R² of the fit. |
| `a_<E>`, `b_<E>` | Fitted parameters; present in tables from recent versions, absent from the bundled example. |
| `diff_meltP_<T>_vs_<V>` | `meltPoint_<T>` − `meltPoint_<V>` (positive: stabilised by the treatment). |
| `min_slope_<T>_vs_<V>` | The smaller of `slope_<T>` and `slope_<V>`. |
| `pVal_adj_<T>_vs_<V>` | p-value of the melting-point difference: a robust z-test within bins of proteins ordered by `min_slope` (`method = "robustZ"`), adjusted with `p.adjust(..., "fdr")`, which is Benjamini–Hochberg. `NA` when the comparison did not pass the filter. |
| `passed_filter_<V>_vs_<T>` | Both curves have R² above `minR2` (default 0.8) and the vehicle plateau is below `maxPlateau` (default 0.3). Note the vehicle-first order of the name in the example table. |
| `model_converged_<E>`, `sufficient_data_for_fit_<E>` | Fit status. |
| `protein_identified_in_<E>` | The protein was present in that experiment. |
| `meltP_diffs_have_same_sign`, `meltP_diffs_T_vs_V_greater_V1_vs_V2`, `minSlopes_less_than_0.06`, `min_pVals_less_0.1_and_max_pVals_less_0.2` (named `min_pVals_less_0.05_and_max_pVals_less_0.1` in the vignette text), `fulfills_all_4_requirements` | The four quality checks, computed only for a design of exactly two treatment and two vehicle experiments. |
| `qssm_<E>`, `qupm_<E>`, other input columns | Copied from the input files; not defined by TPP. |

Fitted model (`fctSigmoidTR`): y(T) = (1 − Pl) / (1 + exp(−(a / T − b))) + Pl.

## Not in the file
- **Temperatures.** The result table has labels, not temperatures: they are in the user's config table.
  `options.temperatures` maps each label to its temperature in °C, per experiment or for all experiments.
- **Which experiments are vehicle and treatment.** Read from the `<T>_vs_<V>` column names.
- **Compound.** `options.compound_id` (as for curvecurator).

## Mapping (to the new dataset kind `thermal_shift`, one row per protein × comparison)
- `feature_id` = `Protein_ID`; `protein_ids` split on ";" unless `options.feature_type = gene` (then `gene_names`).
- `comparison` = `<T> vs <V>`; `treatment_experiment`, `vehicle_experiment`.
- `melt_point_treatment`, `melt_point_vehicle` (°C); `delta_tm` = `diff_meltP` (treatment − vehicle, °C).
- `adj_p_value` = `pVal_adj`; `adj_method` = "BH (TPP robust z-test within slope bins)". No unadjusted p-value
  exists in the table, so `p_value` is not stored.
- `min_slope`, `slope_*`, `plateau_*`, `r2_*`, `passed_filter`, `model_converged_*`.
- `temperatures_c` and the fold-change vectors of both experiments (ordered by temperature), with
  `fold_change_normalised` = true when the columns carry the `norm_` prefix.
- The two-replicate quality checks apply to the protein, not to one comparison: stored on each of its rows as
  `fulfills_all_requirements` (null when the table has no such column).
- `method` = "TPP", `method_version` from `options.tool_version` (the table does not carry it; "not recorded" if absent).

## Never done
- No curve is refitted and no p-value recomputed. A fitted curve is drawn only when `a_<E>` and `b_<E>` are in the
  table; otherwise only the measured points and the reported melting points are shown.
- `NA` stays null. A comparison that did not pass the filter keeps its ΔTm and has a null adjusted p-value.

## Known differences between versions
- `a_<E>` / `b_<E>` columns: absent in the bundled example table, written by `meltCurveParamNames` in 3.40.2.
- The first quality-check column is named with different thresholds in the code (0.1 / 0.2) and in the vignette
  text (0.05 / 0.1): the importer matches `min_pVals_less_*_and_max_pVals_less_*`.
- NPARC results (`tpptrFTest`) are a different table and are out of scope here.
