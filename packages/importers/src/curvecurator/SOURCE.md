# curvecurator — CurveCurator curves file → dose_response

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
CurveCurator README and source (kusterlab/curve_curator main, 0.6.0, Apache-2.0, read 2026-10-30):
`quantification.py` / `thresholding.py` column names ("Ratio {}", "pEC50", "Curve Slope", "Curve Front",
"Curve Back", "Curve Fold Change", "Curve R2", "Curve P_Value", "Curve Relevance Score", "Curve q_Value",
"Curve Regulation"); README TOML parameters `doses`, `dose_scale`, `dose_unit`.

## Mapping
- Doses are not in the output: options.doses (TOML order, control = 0), options.dose_scale, options.dose_unit
  ("M" required), both exactly as written in the TOML. doses_molar = doses × dose_scale; n_doses = distinct non-zero doses.
- responses = Ratio 1..N (in order). pEC50 is −log10(EC50) in dose_unit after dose_scale (quantification.py builds
  log concentrations from doses × dose_scale), so with dose_unit M: pec50 = pEC50, ec50_molar = 10^−pEC50 (recorded).
- hill_slope = Curve Slope; top = Curve Front (response at the low-dose plateau); bottom = Curve Back (high-dose
  plateau) — CurveCurator's front/back, not sorted by size; curve_fold_change = Curve Fold Change (log2, low vs high
  dose per README); r2, curve_p_value, relevance_score, fdr = Curve q_Value (FDR mode only).
- regulation = Curve Regulation (up/down/not); empty (unclassified, thresholding.py sets NaN) → "unclear" (recorded).
- feature_id = Name; protein_ids split on ";" unless options.feature_type = gene; compound_id from options.
