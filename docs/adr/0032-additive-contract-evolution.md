# 0032 — Dataset contracts evolve additively, and older releases stay readable
Date: 2026-11-22 · Status: accepted
## Context
- **Releases are immutable files.** Each dataset release is a Parquet file written under the contract version of its
  day (`dataset_release.contract_version`), and it never changes.
- **The query service read every contract column** from the files. In Phase 47 a column added to `ptm_site_quant`
  made the releases imported before it unreadable. `qc_metrics` and `sample` had already moved to 1.1.0 the same way.
- Rewriting customers' releases would break immutability and the audit trail, so the reader has to cope.
## Decision
- **Additive changes only.** A dataset contract changes by adding nullable columns and raising its version. An
  existing column is never removed, renamed, retyped or made required. A breaking change is a new dataset kind.
- **Every version is recorded** in `packages/contracts/contracts.lock.json` (`pnpm run contracts:lock`). A test
  (CON-05) fails when a contract changes without a new version, or when a version is not additive over the one
  before. History starts with the versions current on 2026-11-22; earlier versions were not recorded.
- **Reading older releases.** Before compiling a query, the query service reads the column names of the release files
  (Parquet footers only). A nullable contract column that none of the files has reads as null. A missing required
  column is refused with 409 `release_schema_outdated`, naming the column (CON-04). Files of different versions are
  read together by name.
## Consequences
- Contract changes cost a version bump and a lock update, and a reviewer sees them in the lock diff.
- A column added later is null for older releases: views and statistics must treat null as "not recorded", never as
  zero or false. Release metadata keeps the contract version, so a page can say why a value is missing.
- Each query reads the files' footers once more; this is small next to reading the data.
## Revisit when
A change cannot be made additively (a rename or a new meaning), or customers need older releases re-imported under a
new version: then a migration path per kind is needed.
