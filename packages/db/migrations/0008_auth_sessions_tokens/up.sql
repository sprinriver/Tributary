-- Phase 3: service accounts, browser sessions (BFF) and personal access tokens.

alter table app_user add column kind text not null default 'human' check (kind in ('human', 'service'));

-- Server-side sessions. The cookie holds a random value; only its sha256 is stored. Rows are short-lived and
-- never edited except to record activity or revocation, so they carry no tenant/audit columns.
create table app_session (
  id uuid primary key default uuidv7(),
  token_hash text not null unique,
  user_id uuid not null references app_user (id),
  csrf_token text not null,
  -- Kept server-side only, for RP-initiated logout (id_token_hint). Never sent to the browser.
  id_token text,
  auth_time timestamptz not null default now(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index app_session_user_idx on app_session (user_id);

-- Personal access tokens for the API, SDK and MCP clients: hashed, scoped, expiring, revocable.
create table access_token (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  user_id uuid not null references app_user (id),
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null check (scopes <@ array['read', 'write']::text[] and cardinality(scopes) > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index access_token_user_idx on access_token (user_id);
create trigger touch_updated_at before update on access_token for each row execute function touch_updated_at();

grant select, insert, update on app_session, access_token to tributary_app;
