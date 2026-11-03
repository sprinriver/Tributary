-- Phase 26 watchlists and alerts (WAT-01…03): personal watches; an alert per watch, release and contrast when a
-- newly published release the watcher can read has a hit for what they watch.

create table watch (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references app_user (id),
  kind text not null check (kind in ('protein', 'gene', 'compound')),
  key text not null,
  label text
);
create unique index watch_unique_idx on watch (user_id, kind, key) where deleted_at is null;
create index watch_key_idx on watch (tenant_id, kind, key) where deleted_at is null;
create trigger touch_updated_at before update on watch for each row execute function touch_updated_at();
grant select, insert, update on watch to tributary_app;

create table alert (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references app_user (id),
  watch_id uuid not null references watch (id),
  release_id uuid not null references dataset_release (id),
  -- '' for releases without contrasts (so the uniqueness below holds).
  contrast_label text not null default '',
  log2_fc double precision,
  adj_p_value double precision,
  rule text not null,
  read_at timestamptz,
  unique (watch_id, release_id, contrast_label)
);
create index alert_user_idx on alert (user_id, id desc) where deleted_at is null;
create trigger touch_updated_at before update on alert for each row execute function touch_updated_at();
grant select, insert, update on alert to tributary_app;
