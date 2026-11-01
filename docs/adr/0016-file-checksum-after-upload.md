# 0016 — FileObject checksum is computed after the upload; files carry version, name, role and lifecycle tag
Date: 2026-10-30 · Status: accepted
## Context
Phase 7 uploads go browser → S3 with presigned multipart URLs (SPEC M3); the API never sees the bytes, and S3
multipart ETags are not content hashes. Linked objects (register by prefix) have no checksum either until they are
read. The Phase 1 `FileObject` contract and the Phase 2a table required `sha256` at insert.
## Decision
`file_object.sha256` (and `FileObject.sha256`) is nullable until the ingest job has streamed the whole object; the
job sets it at `uploaded → type_detected` and stores it in the QC report. Files gain `experiment_version_id`,
`name`, `role` (raw/processed/metadata/other), `upload_id` and `lifecycle_tag` (migration 0011). Breaking for
readers that assumed a checksum on every row: a file with a null checksum has not been ingested yet.
## Alternatives considered
- Client-side sha256 in the browser: Web Crypto has no streaming digest, so a 50 GB file would need a WASM hasher
  and a second read of the file; the server-side job is needed anyway for linked objects.
- S3 additional checksums (`x-amz-checksum-sha256`): per-part checksums of a multipart object are not the object's
  sha256, and SeaweedFS (local stack) support differs.
## Consequences
Consumers must treat `sha256 = null` as "not ingested"; dataset releases (Phase 8) only take `qc_passed` files,
which always have a checksum.
## Revisit when
S3 full-object CRC/sha256 for multipart uploads is available in every target region and in the local stack.
