# spectronaut_report — Spectronaut long report → protein_quant

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
Biognosys documentation is not reachable from the build environment. Column names and roles are taken from
MSstatsConvert `man/SpectronauttoMSstatsFormat.Rd` (Vitek-Lab, 1.23.6, Artistic-2.0, read 2026-10-30):
`PG.ProteinGroups` (protein), `R.FileName` ("Identifies the MS run"), `R.Condition`, `R.Replicate` (condition
and biological replicate), `PG.Qvalue` ("identification confidence"). **Unverified against Biognosys docs:**
`PG.Quantity` (read as the protein-group quantity per run) and `PG.Genes` — the owner should confirm.

## Mapping
One row per distinct (R.FileName, PG.ProteinGroups): the report repeats PG.* columns on every fragment row.
intensity = PG.Quantity, q_value = PG.Qvalue, gene_names = PG.Genes split on ";". Different PG.Quantity values for
one group and run fail the contract's unique rule. A warn rule compares R.Condition with the manifest's condition.
