# 0017 — Dataset releases are immutable Parquet objects catalogued in Postgres (Iceberg adapter pending)
Date: 2026-10-30 · Status: accepted (interim)
## Context
ARCHITECTURE §5 places gold datasets in S3 Tables / Iceberg (locally the SeaweedFS Iceberg REST catalog), read by
DuckDB's `iceberg` + `httpfs` extensions. In the Phase 8 build environment the network policy denies
`extensions.duckdb.org`, so neither extension can be installed; `@duckdb/node-api` 2.0.0 bundles only parquet,
json, icu, core_functions and autocomplete.
## Decision
For now each release is one Parquet file (zstd) written by apps/query with DuckDB `COPY … (FORMAT parquet)` and
uploaded once to `s3://<warehouse>/releases/<kind>/<uuid>.parquet` with the AWS SDK. `dataset_release.storage`
records `{format, bucket, key, sha256, size_bytes}`. Reads download the object into a cache keyed by sha256 (valid
forever: keys are written once and published rows are immutable) and use `read_parquet`. Postgres stays the
catalog (dataset, dataset_release, status, contract version, stats, validation, source, transformations).
## Alternatives considered
- Iceberg via the DuckDB extensions: the target; blocked here, not rejected.
- DuckLake (Postgres catalog): needs the `ducklake` extension — same download problem.
## Consequences
Business time travel already works by release id. Phase 12 compiles QuerySpecs over `read_parquet` of the selected
releases. When the extensions are reachable (CI can download them; the owner can allow the host for this
environment), add an `IcebergReleaseStore` that appends each published release to `gold.<kind>` partitioned by
`experiment_version_id`, keep this layout as the staging format, and backfill existing releases.
## Revisit when
`extensions.duckdb.org` is reachable from the build environment, or before Phase 21 (Terraform for S3 Tables).
