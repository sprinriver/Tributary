# diann_pg_matrix — DIA-NN protein-group matrix → protein_quant

Status: written by Claude in Phase 8; awaiting the owner's review (the owner asked for the project to be completed
without stopping, so the importer was built against this file).

## Source
- DIA-NN README, `vdemichev/DiaNN` master branch (describes DIA-NN 2.x, current release line 2.7.0), read
  2026-10-30: <https://github.com/vdemichev/DiaNN/blob/master/README.md>, sections "Output → Matrices" and
  "Main output reference".
- File: `<report>.pg_matrix.tsv`, tab-separated, one header line, one row per protein group, one column per run.

## Columns read
| Column | Meaning (quoted or paraphrased from the README) | Canonical column |
|---|---|---|
| `Protein.Group` | "inferred proteins" — the protein group; accessions separated by `;` | `protein_group` (verbatim), `protein_ids` (split on `;`) |
| `Protein.Ids` | "all proteins matched to the precursor" (main report column; accepted as an annotation column if present, not imported) | — |
| `Protein.Names` | "names (UniProt names) of the proteins in the Protein.Group" | — (kept in `source.original_columns`) |
| `Genes` | "gene names corresponding to the proteins in the Protein.Group"; may be empty when names are unavailable | `gene_names` (split on `;`; empty → `[]`) |
| `First.Protein.Description` | description of the first protein (not defined in the README beyond the matrices' protein information; not imported) | — |
| every other column | one run; the header is the raw file path | `instrument_run` (file name without directory and extension), `intensity` |

## Quantities and missing values
- Matrices "contain normalised QuantUMS or MaxLFQ quantities for protein groups"; values are linear-scale
  intensities → `intensity`; `normalisation` = `DIA-NN normalised (QuantUMS or MaxLFQ)`.
- Matrices "are filtered at 1% FDR, using global q-values for protein groups" plus "an additional 5% run-specific
  protein-level FDR filter". The matrix carries no q-values, so `q_value` is null.
- "Zero quantities are omitted from protein/gene matrices": an empty cell means not reported. Empty cells become
  rows with `intensity = null` (kept, never imputed or dropped). NA tokens: empty string only.
- `log2_intensity = log2(intensity)` for `intensity > 0` (derived; recorded as a transformation).
- `is_imputed = false` (DIA-NN does not impute matrix values per the README); `n_precursors` is not in the matrix → null.

## Runs → samples
`instrument_run` is matched to the manifest's `instrument_run`, else the run's file name to the file name of the
manifest's `raw_file` (a path or URI). A run that matches no sample fails `run_in_manifest`; a run that matches
more than one sample fails `run_ambiguous` (the release is rejected either way).

## Versions
The matrix carries no DIA-NN version. Header spellings above are the DIA-NN 2.x README's; any extra annotation
column not listed here is treated as a run and so fails `run_in_manifest` loudly rather than being guessed.
Unverified: some 2.x builds may add per-group count columns (e.g. `N.Sequences`); the README read on 2026-10-30
does not list them, so they are not mapped — a real matrix with them fails loudly until they are confirmed.
The tool version is recorded as given by the caller (`options.tool_version`), else `unknown`.
