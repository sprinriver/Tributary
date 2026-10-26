-- SPEC §4 files, datasets, pipelines and customer reference data.

create table file_object (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  bucket text not null,
  key text not null,
  s3_version_id text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes >= 0),
  format text,
  declared_format text,
  storage_class text not null default 'STANDARD',
  ingest_status text not null default 'registered' check (ingest_status in ('registered', 'uploading', 'uploaded',
    'type_detected', 'contract_validated', 'qc_passed', 'qc_failed', 'published', 'rejected')),
  qc_report jsonb
);
create unique index file_object_version_key on file_object (bucket, key, s3_version_id);
create index file_object_sha256_idx on file_object (sha256);

create table sample_file (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sample_id uuid not null references sample (id),
  file_id uuid not null references file_object (id),
  role text not null check (role in ('raw', 'processed', 'other'))
);
create unique index sample_file_key on sample_file (sample_id, file_id, role) where deleted_at is null;

create table dataset (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null check (kind in ('protein_quant', 'precursor_quant', 'differential_abundance', 'dose_response',
    'qc_metrics', 'rnaseq_counts', 'crispr_gene_summary', 'compound', 'compound_property', 'target_annotation',
    'id_mapping', 'experiment_version', 'sample', 'file_object', 'pipeline_run')),
  experiment_version_id uuid references experiment_version (id),
  program_id uuid not null references program (id),
  name text not null
);
create index dataset_version_idx on dataset (experiment_version_id);

create table dataset_release (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  dataset_id uuid not null references dataset (id),
  release_number integer not null check (release_number > 0),
  contract_version text not null,
  storage jsonb not null,
  row_count bigint not null default 0 check (row_count >= 0),
  column_stats jsonb not null default '{}',
  source jsonb not null,
  transformations jsonb not null default '[]',
  status text not null default 'staged' check (status in ('staged', 'published', 'rejected')),
  published_at timestamptz,
  unique (dataset_id, release_number),
  check (status <> 'published' or published_at is not null)
);

create table pipeline_definition (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  key text not null,
  name text not null,
  repo text not null,
  revision text not null,
  runner_types text[] not null,
  assay_types assay_type_key[] not null,
  params_schema jsonb not null default '{}',
  default_params jsonb not null default '{}',
  output_importers jsonb not null default '{}'
);
create unique index pipeline_definition_key on pipeline_definition (tenant_id, key) where deleted_at is null;

create table pipeline_run (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  pipeline_definition_id uuid not null references pipeline_definition (id),
  experiment_version_id uuid not null references experiment_version (id),
  runner text not null check (runner in ('local', 'aws_batch', 'healthomics')),
  external_id text,
  status text not null default 'submitted' check (status in ('submitted', 'pending', 'starting', 'running',
    'stopping', 'succeeded', 'failed', 'cancelled')),
  params jsonb not null default '{}',
  work_dir text,
  output_uri text,
  log_links jsonb not null default '[]',
  started_at timestamptz,
  finished_at timestamptz,
  cost_estimate double precision,
  triggered_by uuid not null
);
create unique index pipeline_run_external_key on pipeline_run (runner, external_id) where external_id is not null;
create index pipeline_run_status_idx on pipeline_run (status) where status not in ('succeeded', 'failed', 'cancelled');

create table compound (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null references program (id),
  compound_id text not null,
  batch_id text,
  name text,
  smiles text,
  inchikey text,
  external_ids jsonb not null default '{}'
);
create unique index compound_key on compound (program_id, compound_id, coalesce(batch_id, '')) where deleted_at is null;
create index compound_inchikey_idx on compound (inchikey);

create table compound_property (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null references program (id),
  compound_id text not null,
  batch_id text,
  property text not null,
  value double precision,
  unit text,
  qualifier text not null default '=' check (qualifier in ('=', '<', '>')),
  assay_category text not null check (assay_category in ('ADME', 'physchem', 'binding', 'functional', 'tox')),
  assay_name text
);
create index compound_property_compound_idx on compound_property (program_id, compound_id);

create table target_annotation (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  uniprot_accession text not null,
  gene_symbol text,
  family text,
  key text not null,
  value text
);
create index target_annotation_accession_idx on target_annotation (uniprot_accession);
create index target_annotation_gene_idx on target_annotation (gene_symbol);
