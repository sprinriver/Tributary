-- Phase 18b admin (SPEC M11): picklists, IdP group → role mappings and tenant settings.

create table picklist_value (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null check (kind in ('species', 'spectral_library', 'time_point')),
  value text not null,
  label text not null,
  position integer not null default 0
);
create unique index picklist_value_key on picklist_value (tenant_id, kind, value) where deleted_at is null;
create trigger touch_updated_at before update on picklist_value for each row execute function touch_updated_at();
grant select, insert, update on picklist_value to tributary_app;

-- Mappings stored by admins; merged at sign-in with AUTH_GROUP_ROLE_MAP from the environment.
create table group_role_mapping (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  group_name text not null,
  role text not null check (role in ('viewer', 'contributor', 'approver', 'admin', 'system_admin')),
  -- Program codes, or '*' for every program; ignored for system_admin.
  programs text[] not null default '{}',
  position integer not null default 0
);
create index group_role_mapping_tenant_idx on group_role_mapping (tenant_id) where deleted_at is null;
create trigger touch_updated_at before update on group_role_mapping for each row execute function touch_updated_at();
grant select, insert, update on group_role_mapping to tributary_app;

create table app_setting (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  key text not null,
  value jsonb not null
);
create unique index app_setting_key on app_setting (tenant_id, key) where deleted_at is null;
create trigger touch_updated_at before update on app_setting for each row execute function touch_updated_at();
grant select, insert, update on app_setting to tributary_app;
