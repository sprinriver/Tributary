# maxquant_sites — MaxQuant `<modification>Sites.txt` → ptm_site_quant

Status: written by Claude in Phase 47; awaiting the owner's review.

## Source
- Cox lab, MaxQuant documentation, "Output Tables" → "5 Site Table"
  (https://cox-labs.github.io/coxdocs/output_tables.html, page dated 2025-10-14), read through a web scrape because
  the page is not reachable from the build environment. Several columns have no description there; for those the
  meaning below is marked **(not described in the documentation)** and comes from the column name and MaxQuant's
  usual behaviour, for the owner to confirm.
- The flag convention ("+" in `Reverse` / `Potential contaminant`, rows to remove) is the documentation's own and
  matches `maxquant_protein_groups`.
- Localisation classes: Olsen et al. 2006, Cell 127:635, doi:10.1016/j.cell.2006.09.026 (class I: localisation
  probability > 0.75). Tributary stores the probability only; the threshold is a display choice.
- DIA-NN's site report (`.site_report.parquet`) is described in the DIA-NN README only in prose; its columns are not
  documented publicly, so no importer is written for it.

## Layout (one row per modification site)
| Column | Meaning |
|---|---|
| `Proteins` | Identifiers of the proteins this site is associated with (";"-separated). |
| `Positions within proteins` | For each protein in `Proteins`, the position of the site in that protein (first residue = 1). |
| `Protein` | Identifier of the protein the site is reported for (the leading one). |
| `Gene names`, `Protein names` | Names of the genes and proteins (";"-separated). |
| `Amino acid` | The modified residue (one letter) **(not described in the documentation)**. |
| `Position` | The position of the modification in the protein sequence. |
| `Sequence window` | Sequence around the site **(not described in the documentation)**. |
| `Localization prob` | Best localisation probability of the site across the experiment **(not described in the documentation)**. |
| `Localization prob <exp>` | The same, for one experiment (sample) **(not described in the documentation)**. |
| `Score diff`, `Score` | Andromeda localisation score difference; score of the best modified peptide with this site. |
| `PEP` | Posterior error probability of the best identified modified peptide containing this site. |
| `<mod> Probabilities` | e.g. `Phospho (STY) Probabilities`: the peptide with per-residue probabilities; gives the modification name. |
| `Intensity <exp>___<j>` | Summed XIC for experiment `<exp>`; `j` = 1, 2 or 3 is the multiplicity (peptides carrying one, two, or three or more modifications of this type) **(the meaning of j is not described in the documentation)**. |
| `Intensity <exp>` | Summed XIC for experiment `<exp>`, all multiplicities together. |
| `Intensity L/M/H <exp>`, `Ratio …`, `Occupancy …`, `Reporter intensity …` | Labelled (SILAC, TMT) and occupancy columns. |
| `Reverse`, `Potential contaminant` | "+" marks decoy and contaminant rows, to be removed. |
| `id` | Row identifier, used by other MaxQuant tables. |

MaxQuant writes 0 for an intensity that was not measured; `NaN` and empty cells can also occur.

## Mapping to `ptm_site_quant` (one row per site × sample × multiplicity)
- `site_id` = `<Protein>_<Amino acid><Position>`, e.g. `P31749_S473`.
- `protein` = `Protein`; `protein_ids` = `Proteins` split on ";"; `positions_in_proteins` = `Positions within proteins`
  split on ";" (kept as text, in the same order); `gene_names` = `Gene names` split on ";".
- `modification` = the name before ` Probabilities` (exactly one such column), else `options.modification`.
- `amino_acid`, `position`, `sequence_window`, `localization_prob`, `score_diff`, `pep` as reported.
- Quantities: `Intensity <exp>___<j>` when the table has them (`multiplicity` = j), else `Intensity <exp>`
  (`multiplicity` null). `<exp>` → manifest sample (sample_key, instrument_run or raw file name), as for every importer.
  `localization_prob_sample` = `Localization prob <exp>` when present.
- `intensity` as reported, zeros kept; `log2_intensity` = log2(intensity) where intensity > 0, else null.
- Rows with "+" in `Reverse` or `Potential contaminant` are removed and counted (warning `flagged_rows_removed`);
  `options.keep_flagged` keeps them.
- Not imported: labelled channels (`Intensity L/M/H`, ratios), reporter intensities, occupancies, scores per
  experiment, identifiers linking to other tables. A table with only labelled or reporter intensities is refused.
- `method` = "MaxQuant", `method_version` from `options.tool_version` ("unknown" if absent).

## Never done
No site is re-localised, no intensity is normalised (to the protein or otherwise), imputed or summed across
multiplicities, and no occupancy is computed.
