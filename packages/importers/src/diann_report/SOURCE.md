# diann_report_parquet / diann_report_qc — DIA-NN main report → precursor_quant + qc_metrics

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
DIA-NN README (vdemichev/DiaNN master, DIA-NN 2.x, read 2026-10-30), "Main output reference": the main report is
`.parquet`. SPEC §6.3 asks for precursor_quant + qc_metrics from one file; the framework writes one kind per
release, so there are two importer keys over the same file.

## Columns read (README wording)
| Column | Meaning | Canonical |
|---|---|---|
| Run | "raw file name without file path" | instrument_run (extension stripped) → manifest sample_key |
| Precursor.Id | "modified peptide sequence with a specific charge, channel-oblivious" | precursor_id |
| Modified.Sequence | "modified peptide sequence, channel-oblivious" | modified_sequence |
| Precursor.Charge | "the charge of the precursor" | charge |
| Protein.Group / Genes | "inferred proteins" / gene names | protein_group (verbatim), protein_ids, gene_names (split on ";") |
| Precursor.Normalised | "MS2-based quantity of the precursor (charged peptide), normalised" | intensity |
| Q.Value / PG.Q.Value / Global.Q.Value | run-specific precursor q / protein-group q / global precursor q | q_value / pg_q_value / global_q_value |
| RT | "retention time (RT) of the PSM in minutes" | retention_time (min) |
| IM | ion mobility, analogous to RT | ion_mobility |

## qc_metrics (diann_report_qc)
Per run: `precursors` = distinct Precursor.Id rows in the report, `protein_groups` = distinct Protein.Group (counts,
unit "count"; no filtering — the report as exported). Status `not_assessed` unless `options.min_precursors` is
given (then pass/fail against it).

## Missing values / versions
Parquet nulls only. Older DIA-NN 1.x TSV reports are not supported by this key. Tool version from options.
