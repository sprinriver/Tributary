# quantms_qpx — quantms QPX pg Parquet → protein_quant

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
QPX canonical schema `qpx/core/data/schemas/pg.yaml` (bigbio/qpx main, Apache-2.0, read 2026-10-30).

## Columns read
| Field | Schema doc | Canonical |
|---|---|---|
| pg_accessions (list<string>) | "Protein accessions within this group" | protein_ids; protein_group = joined with ";" |
| gg_names (list<string>) | "Gene group names (gene symbols from tool output)" | gene_names |
| grouped_runs (list<string>) | "Raw files grouped into this quantification unit (... single-element for unfractionated/DIA)" | instrument_run → manifest |
| intensity (float32, nullable) | "Primary intensity for this label" | intensity |
| pg_qvalue | "Protein group q-value at run level" | q_value |
| is_decoy / contaminant (bool) | decoy / contaminant flags | flagged rows removed and counted (warn rule), unless options.keep_flagged |
Units with more than one grouped run (fractions) fail `single_run_unit` (not supported yet).
