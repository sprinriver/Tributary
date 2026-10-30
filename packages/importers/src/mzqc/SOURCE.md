# mzqc — HUPO-PSI mzQC → qc_metrics

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
mzQC JSON schema v1.0.0 (HUPO-PSI/mzQC `schema/mzqc_schema.json`, read 2026-10-30): `mzQC.runQualities[]`
each with `metadata.inputFiles[]` ("name: Base file name") and `qualityMetrics[]` (cvParameter: accession, name,
value; optional `unit` cvParameter or array).

## Mapping
- scope = `run`, scope_key = first input file name without extension (→ the manifest's instrument_run).
- metric = "<name> (<accession>)"; value = numeric `value` only; unit = unit name (first when an array).
- Non-numeric values (tables, strings, arrays) and setQualities are not imported; their count is recorded.
- threshold = null, status = `not_assessed` (mzQC carries no thresholds).
