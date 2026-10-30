-- Phase 6: OLS4 lookup cache (works offline once filled; SPEC M2) and column-mapping presets per program.

create table ontology_term_cache (
  id uuid primary key default uuidv7(),
  ontology text not null,
  term_id text not null unique,
  label text not null,
  synonyms text[] not null default '{}',
  fetched_at timestamptz not null default now()
);
create index ontology_term_cache_label_idx on ontology_term_cache (ontology, lower(label));

create table ontology_query_cache (
  id uuid primary key default uuidv7(),
  ontology text not null,
  query text not null,
  term_ids text[] not null,
  fetched_at timestamptz not null default now(),
  unique (ontology, query)
);

create table mapping_preset (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null references program (id),
  name text not null,
  -- uploaded header → manifest column key
  mapping jsonb not null
);
create unique index mapping_preset_name_key on mapping_preset (program_id, name) where deleted_at is null;
create trigger touch_updated_at before update on mapping_preset for each row execute function touch_updated_at();

grant select, insert, update on ontology_term_cache, ontology_query_cache, mapping_preset to tributary_app;
