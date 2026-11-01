-- Phase 8: importer runs produce dataset releases (SPEC M5, §6.2–6.3).

alter table dataset_release
  add column importer text,
  add column file_id uuid references file_object (id),
  -- Quality-rule outcome of the import: {"passed": bool, "failures": [...]}.
  add column validation jsonb not null default '{"passed": true, "failures": []}',
  -- Reason given when the release was published or rejected.
  add column status_reason text;
create index dataset_release_dataset_idx on dataset_release (dataset_id, release_number);
create index dataset_release_file_idx on dataset_release (file_id);

-- One dataset per (program, experiment version or none, kind, name); releases accumulate under it.
create unique index dataset_identity_key on dataset
  (program_id, coalesce(experiment_version_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, name)
  where deleted_at is null;

-- Saved custom_tabular mappings (SPEC §6.3): canonical column → source column, plus constants.
create table import_preset (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null references program (id),
  name text not null,
  kind text not null,
  columns jsonb not null,
  constants jsonb not null default '{}'
);
create unique index import_preset_name_key on import_preset (program_id, name) where deleted_at is null;
create trigger touch_updated_at before update on import_preset for each row execute function touch_updated_at();

grant select, insert, update on import_preset to tributary_app;
