# alphadia_precursors / alphadia_pg_matrix — AlphaDIA → precursor_quant / protein_quant

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
AlphaDIA source `alphadia/constants/keys.py` (MannLabs/alphadia main, version 2.3.2-dev0, Apache-2.0, read
2026-10-30): `PrecursorOutputCols`, `ProteinGroupOutputCols`, `OutputRawCols`, output stem `precursors` and
matrices `<level>.matrix` with level key `pg`. The README has no column reference.

## precursors table (alphadia_precursors)
| Column | Canonical |
|---|---|
| raw.name | instrument_run → manifest |
| precursor.mod_seq_charge_hash | precursor_id |
| precursor.sequence (+ precursor.mods / precursor.mod_sites when not empty) | modified_sequence = sequence, or `sequence [mods@sites]` (recorded) |
| precursor.charge | charge |
| pg.name / pg.genes | protein_group (verbatim), protein_ids, gene_names (split on ";") |
| precursor.intensity | intensity |
| precursor.qval / pg.qval | q_value / pg_q_value |
| precursor.mobility.observed | ion_mobility |
Not imported: precursor.rt.observed — keys.py does not state its unit, so retention_time stays null rather than
guessed.

## pg matrix (alphadia_pg_matrix)
Index column `pg` (QuantificationLevelKey.PROTEIN), one column per run → protein_quant (melted like DIA-NN; empty
= null). gene_names = [] (not in the matrix). Normalisation method is not in the file → null.
