-- Phase 24 pathway enrichment (ENR-02): gene-set collections (GO, Reactome, in-house), versioned by source release.
-- A collection is immutable once imported: a newer source release is a new collection.

create table gene_set_collection (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  source text not null,
  source_release text not null,
  species text not null,
  id_type text not null check (id_type in ('gene_symbol', 'uniprot_accession')),
  set_count integer not null,
  member_count integer not null
);
create index gene_set_collection_tenant_idx on gene_set_collection (tenant_id) where deleted_at is null;
create trigger touch_updated_at before update on gene_set_collection for each row execute function touch_updated_at();
grant select, insert, update on gene_set_collection to tributary_app;

create table gene_set (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  collection_id uuid not null references gene_set_collection (id),
  -- The source's own id (e.g. R-HSA-69278, GO:0006915) and display name.
  set_key text not null,
  name text not null,
  members text[] not null,
  unique (collection_id, set_key)
);
create index gene_set_collection_idx on gene_set (collection_id);
create trigger touch_updated_at before update on gene_set for each row execute function touch_updated_at();
grant select, insert, update on gene_set to tributary_app;
