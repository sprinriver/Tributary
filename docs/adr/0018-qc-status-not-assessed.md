# 0018 — qc_metrics status gains `not_assessed` (contract 1.1.0)
Date: 2026-10-30 · Status: accepted
## Context
The qc_metrics contract (1.0.0) required `status ∈ {pass, warn, fail}`. mzQC files and the DIA-NN report carry
metrics but no thresholds, so any of those values would be an invented judgement.
## Decision
Add `not_assessed` to the status enum and bump qc_metrics to 1.1.0. Importers set pass/warn/fail only against a
threshold they record in `threshold` (from the tool or from import options); otherwise `not_assessed`.
## Consequences
Additive change: existing releases (none of this kind yet) stay valid. Charts and results pages must show
`not_assessed` neutrally (not as a pass).
