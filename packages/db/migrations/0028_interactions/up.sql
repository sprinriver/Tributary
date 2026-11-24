-- Phase 45 interaction networks (PPI-02): collections of pairwise interactions (STRING, in-house), versioned by
-- source release. A collection is immutable once imported: a newer source release is a new collection.

create table interaction_collection (
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
  -- The source's licence, shown with every network (e.g. STRING: CC BY 4.0).
  licence text,
  edge_count integer not null,
  node_count integer not null
);
create index interaction_collection_tenant_idx on interaction_collection (tenant_id) where deleted_at is null;
create trigger touch_updated_at before update on interaction_collection for each row execute function touch_updated_at();
grant select, insert, update on interaction_collection to tributary_app;

-- One row per unordered pair (a < b). Scores are whole numbers from 0 to 1000 (STRING's combined score × 1000).
create table interaction_edge (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  collection_id uuid not null references interaction_collection (id),
  a text not null,
  b text not null,
  score integer not null check (score between 0 and 1000),
  check (a < b),
  unique (collection_id, a, b)
);
create index interaction_edge_b_idx on interaction_edge (collection_id, b);
create trigger touch_updated_at before update on interaction_edge for each row execute function touch_updated_at();
grant select, insert, update on interaction_edge to tributary_app;
