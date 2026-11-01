-- SPEC §4 users, groups, role bindings, saved views, lineage and the audit log.

create table app_user (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sub text not null,
  email text not null,
  name text not null default '',
  last_login_at timestamptz
);
create unique index app_user_sub_key on app_user (tenant_id, sub);

create table app_group (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null
);
create unique index app_group_name_key on app_group (tenant_id, name) where deleted_at is null;

create table group_member (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  group_id uuid not null references app_group (id),
  user_id uuid not null references app_user (id)
);
create unique index group_member_key on group_member (group_id, user_id) where deleted_at is null;

create table role_binding (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid references app_user (id),
  group_id uuid references app_group (id),
  program_id uuid references program (id),
  role text not null check (role in ('viewer', 'contributor', 'approver', 'admin', 'system_admin')),
  check ((user_id is null) <> (group_id is null)),
  -- system_admin is the only global role; every other role is bound to a program.
  check ((role = 'system_admin') = (program_id is null))
);
create index role_binding_user_idx on role_binding (user_id) where deleted_at is null;
create index role_binding_group_idx on role_binding (group_id) where deleted_at is null;

create table saved_view (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  owner uuid not null references app_user (id),
  program_id uuid references program (id),
  query_spec jsonb not null,
  chart_spec jsonb,
  visibility text not null default 'private' check (visibility in ('private', 'program')),
  share_token text unique,
  check (visibility = 'private' or program_id is not null)
);

-- OpenLineage-shaped graph, traversed with recursive CTEs.
create table lineage_node (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  kind text not null check (kind in ('file', 'dataset_release', 'pipeline_run', 'experiment_version', 'chart',
    'ai_artifact')),
  entity_id uuid not null,
  unique (kind, entity_id)
);

create table lineage_edge (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  from_node_id uuid not null references lineage_node (id),
  to_node_id uuid not null references lineage_node (id),
  relation text not null check (relation in ('input_to', 'produced', 'derived_from', 'describes')),
  unique (from_node_id, to_node_id, relation)
);
create index lineage_edge_to_idx on lineage_edge (to_node_id);

-- Append-only: the app role gets INSERT/SELECT only (0006) and a trigger rejects UPDATE/DELETE/TRUNCATE (0005).
-- It has no updated_at/deleted_at because rows never change.
create table audit_log (
  id uuid primary key default uuidv7(),
  tenant_id uuid,
  actor_id uuid not null,
  actor_type text not null check (actor_type in ('user', 'service', 'ai_assistant_on_behalf_of')),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  reason text,
  request_id text not null,
  ip inet,
  at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity_type, entity_id, at);
create index audit_log_actor_idx on audit_log (actor_id, at);
