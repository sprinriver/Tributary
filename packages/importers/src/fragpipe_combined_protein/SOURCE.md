# fragpipe_combined_protein — FragPipe combined_protein.tsv → protein_quant

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
FragPipe documentation "FragPipe output files", combined_protein.tsv section (Nesvilab/FragPipe gh-pages
`docs/tutorial_fragpipe_outputs.md`, read 2026-10-30).

## Columns read
| Column | Docs | Canonical |
|---|---|---|
| Protein ID | "protein identifier (primary accession number) for the selected protein" | protein_group, protein_ids |
| Gene | "gene name for the selected protein" | gene_names |
| `[experiment] MaxLFQ Intensity` | "normalized (by default) protein intensity using the razor peptides (from the MaxLFQ method)" | intensity (preferred) |
| `[experiment] Intensity` | "normalized (by default) protein intensity using the razor peptides (from the top-N algorithm)" | intensity when no MaxLFQ columns |
| Indistinguishable Proteins | proteins that cannot be distinguished from the selected protein | — (not merged into the group; kept in source) |
[experiment] → manifest (sample_key, else instrument_run). Zero intensities kept as reported; log2 null for them.
