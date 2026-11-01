-- SPEC §4 registry entities. Every table carries tenant_id, created_*, updated_at, deleted_at (soft delete only).

create table program (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  code text not null,
  description text not null default ''
);
create unique index program_code_key on program (tenant_id, code) where deleted_at is null;

create table assay_type (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  key assay_type_key not null,
  label text not null,
  family text not null check (family in ('proteomics', 'genomics')),
  enabled boolean not null default true
);
create unique index assay_type_key_key on assay_type (tenant_id, key) where deleted_at is null;

create table metadata_template (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  assay_type assay_type_key not null,
  version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  key_field text not null
);
create unique index metadata_template_version_key on metadata_template (tenant_id, assay_type, version)
  where deleted_at is null;

create table experiment (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null references program (id),
  assay_type assay_type_key not null,
  name text not null,
  urn text not null unique
);
create index experiment_program_idx on experiment (program_id);

create table experiment_version (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  experiment_id uuid not null references experiment (id),
  version_number integer not null check (version_number > 0),
  parent_version_id uuid references experiment_version (id),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  template_version text not null,
  experiment_date date,
  species jsonb,
  spectral_library text,
  time_points jsonb not null default '[]',
  description text not null default '',
  custom jsonb not null default '{}',
  publish_reason text,
  published_by uuid,
  published_at timestamptz,
  urn text not null unique,
  -- Full-text search over the description and custom string values (M9).
  search_tsv tsvector generated always as (
    to_tsvector('simple'::regconfig, description) || jsonb_to_tsvector('simple'::regconfig, custom, '["string"]')
  ) stored,
  -- Semantic search placeholder: the dimension is fixed when the embedding model is chosen (Phase 17).
  embedding vector(1024),
  unique (experiment_id, version_number),
  constraint experiment_version_publish_fields check (
    status = 'draft' or (publish_reason is not null and published_by is not null and published_at is not null)
  )
);
create index experiment_version_search_tsv_idx on experiment_version using gin (search_tsv);
create index experiment_version_custom_idx on experiment_version using gin (custom);
create index experiment_version_embedding_idx on experiment_version using hnsw (embedding vector_cosine_ops);

-- Template fields (template_id) and per-version custom fields (experiment_version_id).
create table metadata_field_def (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  template_id uuid references metadata_template (id),
  experiment_version_id uuid references experiment_version (id),
  position integer not null default 0,
  scope text not null check (scope in ('experiment', 'sample')),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null,
  type text not null check (type in ('text', 'number', 'integer', 'boolean', 'date', 'enum', 'ontology_term', 'quantity')),
  required boolean not null default false,
  searchable boolean not null default false,
  unit text,
  ontology text,
  enum_values text[],
  quantity_kind text check (quantity_kind in ('concentration', 'time')),
  validator text check (validator in ('plate_well')),
  check ((template_id is null) <> (experiment_version_id is null))
);
create unique index metadata_field_def_template_key on metadata_field_def (template_id, scope, key)
  where template_id is not null and deleted_at is null;
create unique index metadata_field_def_version_key on metadata_field_def (experiment_version_id, scope, key)
  where experiment_version_id is not null and deleted_at is null;

create table sample (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  experiment_version_id uuid not null references experiment_version (id),
  sample_key text not null,
  source_name text,
  characteristics jsonb not null default '{}',
  factors jsonb not null default '{}',
  technical jsonb not null default '{}',
  custom jsonb not null default '{}',
  validation_errors jsonb not null default '{}'
);
create unique index sample_key_in_version on sample (experiment_version_id, sample_key) where deleted_at is null;
create index sample_characteristics_idx on sample using gin (characteristics);
create index sample_factors_idx on sample using gin (factors);
create index sample_custom_idx on sample using gin (custom);

create table contrast (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  experiment_version_id uuid not null references experiment_version (id),
  label text not null,
  numerator text not null,
  denominator text not null,
  method_hint text
);
create unique index contrast_label_in_version on contrast (experiment_version_id, label) where deleted_at is null;
