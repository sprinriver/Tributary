-- Phase 7: files attach to experiment versions and move through the ingest state machine (SPEC M3, §7.3).

alter table file_object
  add column experiment_version_id uuid references experiment_version (id),
  add column name text,
  add column role text not null default 'raw' check (role in ('raw', 'processed', 'metadata', 'other')),
  add column upload_id text,
  add column lifecycle_tag text,
  -- The checksum is computed by the ingest job after the upload completes (ADR 0016).
  alter column sha256 drop not null;
update file_object set name = regexp_replace(key, '^.*/', '') where name is null;
alter table file_object alter column name set not null;
create index file_object_version_idx on file_object (experiment_version_id) where deleted_at is null;

-- Files are added to drafts only; status changes (ingest, QC) continue after publish.
create function guard_file_object_insert() returns trigger language plpgsql as $$
declare frozen uuid;
begin
  if new.experiment_version_id is null then return new; end if;
  select id into frozen from experiment_version where id = new.experiment_version_id and status <> 'draft';
  if frozen is not null then
    raise exception 'files cannot be added to experiment_version %: it is not a draft', frozen
      using errcode = 'TR409';
  end if;
  return new;
end
$$;
create trigger guard_file_object_insert before insert on file_object
  for each row execute function guard_file_object_insert();

-- Approver overrides of failed QC (SPEC M3 QC gate). Covers the failed files listed; append-only by convention.
create table qc_override (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references app_user (id),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  experiment_version_id uuid not null references experiment_version (id),
  reason text not null check (length(btrim(reason)) >= 10),
  file_ids uuid[] not null
);
create index qc_override_version_idx on qc_override (experiment_version_id, created_at);
create trigger touch_updated_at before update on qc_override for each row execute function touch_updated_at();

-- Storage lifecycle per file role (SPEC M3), applied as object tags; bucket rules filter on the tag.
create table lifecycle_policy (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  role text not null check (role in ('raw', 'processed', 'metadata', 'other', 'work', 'export')),
  tag text not null check (tag ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  transition_days integer check (transition_days > 0),
  storage_class text check (storage_class in ('STANDARD_IA', 'INTELLIGENT_TIERING', 'GLACIER_IR', 'GLACIER',
    'DEEP_ARCHIVE')),
  expiration_days integer check (expiration_days > 0),
  check ((transition_days is null) = (storage_class is null))
);
create unique index lifecycle_policy_role_key on lifecycle_policy (tenant_id, role) where deleted_at is null;
create trigger touch_updated_at before update on lifecycle_policy for each row execute function touch_updated_at();

grant select, insert, update on qc_override, lifecycle_policy to tributary_app;
