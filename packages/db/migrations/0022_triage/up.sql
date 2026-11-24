-- Phase 25 hit triage board (TRI-01…03): decisions on proteins and compounds per program, with evidence snapshots and
-- an append-only history (events are inserted, never updated: the app role has no UPDATE on triage_event).

create table triage_item (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  program_id uuid not null references program (id),
  kind text not null check (kind in ('protein', 'compound')),
  -- UniProt accession or compound id.
  key text not null,
  label text,
  status text not null default 'new' check (status in ('new', 'advance', 'watch', 'drop')),
  owner_id uuid references app_user (id)
);
create unique index triage_item_unique_idx on triage_item (program_id, kind, key) where deleted_at is null;
create index triage_item_program_idx on triage_item (program_id, status) where deleted_at is null;
create trigger touch_updated_at before update on triage_item for each row execute function touch_updated_at();
grant select, insert, update on triage_item to tributary_app;

create table triage_evidence (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  item_id uuid not null references triage_item (id),
  release_id uuid not null references dataset_release (id),
  contrast_label text,
  -- Snapshot of the item's row when added (releases are immutable, so it stays true).
  log2_fc double precision,
  adj_p_value double precision
);
create index triage_evidence_item_idx on triage_evidence (item_id);
create trigger touch_updated_at before update on triage_evidence for each row execute function touch_updated_at();
grant select, insert, update on triage_evidence to tributary_app;

create table triage_event (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  item_id uuid not null references triage_item (id),
  type text not null check (type in ('created', 'status', 'owner', 'comment', 'evidence')),
  from_value text,
  to_value text,
  text text
);
create index triage_event_item_idx on triage_event (item_id, id);
grant select, insert on triage_event to tributary_app;
