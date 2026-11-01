-- Phase 17 search (SPEC M9, ADR 0020): one derived document per searchable entity (an experiment's latest
-- published version, and each of its samples), full-text over weighted fields, optional embeddings.
-- Reindexing upserts an experiment's documents and soft-deletes the ones that no longer apply.

create table search_document (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  entity_type text not null check (entity_type in ('experiment', 'sample')),
  entity_id uuid not null,
  experiment_id uuid not null references experiment (id),
  experiment_version_id uuid not null references experiment_version (id),
  program_id uuid not null references program (id),
  assay_type text not null,
  status text not null,
  species text[] not null default '{}',
  compounds text[] not null default '{}',
  title text not null,
  subtitle text not null default '',
  body text not null default '',
  -- Ontology labels and synonyms of the terms the entity uses, and de-hyphenated word forms (K-562 → k562).
  expansions text not null default '',
  -- What was embedded (title, subtitle, body, expansions); an embedding is reused while this is unchanged.
  content_hash text not null,
  tsv tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, title), 'A')
      || setweight(to_tsvector('simple'::regconfig, subtitle || ' ' || body), 'B')
      || setweight(to_tsvector('simple'::regconfig, expansions), 'C')
  ) stored,
  unique (entity_type, entity_id)
);
create index search_document_tsv_idx on search_document using gin (tsv) where deleted_at is null;
create index search_document_program_idx on search_document (program_id, entity_type) where deleted_at is null;
create index search_document_experiment_idx on search_document (experiment_id);
create trigger touch_updated_at before update on search_document for each row execute function touch_updated_at();
grant select, insert, update on search_document to tributary_app;

-- Embeddings of one provider/model, stored at 1024 dimensions (Titan v2 and Voyage 4 both offer 1024; shorter
-- vectors are zero-padded, which leaves cosine similarity unchanged). Replaced in place when the text changes.
create table search_embedding (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  document_id uuid not null references search_document (id),
  provider text not null,
  model text not null,
  content_hash text not null,
  embedding vector(1024) not null,
  unique (document_id, provider, model)
);
-- Cosine HNSW; queries filter by program, so they run with iterative index scans (pgvector >= 0.8).
create index search_embedding_hnsw_idx on search_embedding using hnsw (embedding vector_cosine_ops);
create trigger touch_updated_at before update on search_embedding for each row execute function touch_updated_at();
grant select, insert, update on search_embedding to tributary_app;
