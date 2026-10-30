# maxquant_protein_groups — MaxQuant proteinGroups.txt → protein_quant

Status: written by Claude in Phase 9; awaiting the owner's review (built against this file without stopping, as the owner asked).

## Source
MaxQuant's own tables documentation (maxquant.org) is not reachable from the build environment. Flag columns and
their "+" convention are taken from MSstatsConvert `R/clean_MaxQuant.R` (1.23.6, Artistic-2.0; read only):
`Contaminant` / `Potential contaminant` (renamed across versions), `Reverse`, `Only identified by site`.
**Unverified against MaxQuant docs:** `Protein IDs`, `Gene names`, `Q-value`, `LFQ intensity <sample>`,
`Intensity <sample>` — the owner should confirm.

## Mapping
- protein_group = Protein IDs (verbatim), protein_ids split on ";", gene_names = Gene names split on ";".
- Quantity columns: `LFQ intensity <sample>` when present, else `Intensity <sample>`; <sample> → manifest
  (sample_key, else instrument_run). intensity as reported: MaxQuant writes 0 for not quantified; zeros are kept,
  log2_intensity is null for them (recorded).
- q_value = Q-value (protein level, same for every run).
- SPEC §6.3: rows flagged "+" in Reverse, (Potential) contaminant or Only identified by site are removed only when
  flagged, recorded as a transformation with the count (warn rule `flagged_rows_removed`); `options.keep_flagged`
  keeps them.
