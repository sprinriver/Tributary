-- Phase 31 team notifications (NOTIF-01…04): routes to Slack or Teams channels, and an outbox of deliveries that a
-- background sweep sends (with retries), so no request ever waits on a chat service.

create table notification_route (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  name text not null,
  kind text not null check (kind in ('slack', 'teams')),
  -- The channel's incoming-webhook URL: a secret, never returned by the API.
  url text not null,
  program_id uuid references program (id),
  events text[] not null,
  active boolean not null default true
);
create index notification_route_tenant_idx on notification_route (tenant_id) where deleted_at is null;
create trigger touch_updated_at before update on notification_route for each row execute function touch_updated_at();
grant select, insert, update on notification_route to tributary_app;

create table notification_delivery (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  route_id uuid not null references notification_route (id),
  event text not null,
  title text not null,
  -- The message as sent (names, statuses and links only).
  message jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  error text,
  delivered_at timestamptz
);
create index notification_delivery_due_idx on notification_delivery (next_attempt_at) where status = 'pending';
create index notification_delivery_route_idx on notification_delivery (route_id, id desc);
create trigger touch_updated_at before update on notification_delivery for each row execute function touch_updated_at();
grant select, insert, update on notification_delivery to tributary_app;
