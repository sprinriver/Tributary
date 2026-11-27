-- Provenance of reference annotations fetched from public services (public annotation plan, stage 1: UniProt).
-- Nullable: curated and seeded annotations have no external source. A refresh soft-deletes the previous rows and
-- inserts new ones, so earlier releases stay readable.
alter table target_annotation
  add column source text,
  add column source_release text,
  add column retrieved_at timestamptz;

create index target_annotation_source_idx on target_annotation (tenant_id, source, uniprot_accession)
  where deleted_at is null;
