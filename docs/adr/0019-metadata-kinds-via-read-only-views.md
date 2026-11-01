# 0019 — Metadata kinds read through read-only views, loaded per query (not DuckDB's postgres extension)
Date: 2026-10-31 · Status: accepted (revisit when DuckDB extensions can be installed in the build)
## Context
ARCHITECTURE §6 reads the metadata kinds (`experiment_version`, `sample`, `file_object`, `pipeline_run`) live
from program-scoped Postgres views through DuckDB's postgres extension, as a read-only role. DuckDB 2.0's node
package ships only parquet/json/icu built in; `postgres` must be downloaded from extensions.duckdb.org, which the
build and CI environments cannot reach (the same block as the iceberg/httpfs extensions in Phase 8).
## Decision
Keep the views and the role, change the transport: migration 0014 adds schema `query_meta` (one view per
metadata kind, with `program_id`) and role `tributary_query_ro` (SELECT on those views only). apps/query reads a
view with node-postgres inside a `READ ONLY` transaction after `SET LOCAL ROLE tributary_query_ro`, filtered to
the program ids (and version ids) apps/api resolved for the caller, writes the rows to a per-request DuckDB temp
table cast to the contract's types, and joins it like a release. Metadata pages are never cached.
## Consequences
Same scoping and read-only guarantees; one round trip per metadata source per query, which is fine for
metadata sizes (thousands to low millions of rows) but slower than the extension's pushdown for very large
`sample` tables. If the extension becomes installable (bundled in the container image), swap the loader for
`ATTACH … (TYPE postgres, READ_ONLY)` behind the same `SourceInput { table }` interface; the compiler is
unchanged.
