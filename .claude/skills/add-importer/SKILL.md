---
name: add-importer
description: Procedure for adding a dataset importer (tool output to a canonical dataset kind) in packages/importers. Use when implementing any importer listed in docs/SPEC.md section 6.3.
---
Reference implementation: packages/importers/diann_pg_matrix (built in Phase 8). Copy its structure exactly.

1. **SOURCE.md first.** If packages/importers/<key>/SOURCE.md already exists, it has been approved by the user:
   read it and follow it; never rewrite it. Otherwise write it: official docs link, exact tool version, every
   input column you read with meaning and units, NA tokens, and known renames across versions — then stop for
   approval. If official docs don't define a column, say so; never guess what a column means.
2. **Fixture.** Extend the synthetic generator (`pnpm synth`) to write a small deterministic file in the tool's
   real format: delimiter, header spelling, NA tokens; add a decimal-comma variant if the tool can emit one.
3. **Module files.** `detect.ts` (header signature + version detection) · `map.ts` (per-version column map →
   canonical columns) · `sql.ts` (DuckDB SQL built only from the map; values parameterized) · `rules.ts`
   (quality rules from the dataset contract plus importer-specific checks) · `index.ts` (registry entry: key,
   kind, tool, supported versions).
4. **Preserve originals.** Write original column names and the tool version into release metadata; record
   every transformation (melt, split, unit conversion, filtering) in `transformations`.
5. **Tests** (titles start with the feature ID and include the importer key, e.g.
   `DS-06: maxquant_protein_groups golden`): golden test (fixture → canonical rows hash), version-rename
   test, decimal-comma test where applicable, broken-file test that names the failing rule.
6. **Register** the importer and add it to any PipelineDefinition `output_importers` that should use it.
7. Run `pnpm run test:importers <importer key>` and paste the result.

Read tool outputs only. Never run the tool itself, and never copy code from GPL or proprietary tools.
