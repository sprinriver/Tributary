-- Phase 20 webhooks (SPEC M13): HMAC-signed run-status notifications to customer endpoints.

create table webhook_subscription (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  url text not null,
  description text not null default '',
  events text[] not null default '{run.status}',
  active boolean not null default true,
  -- Signing secret (shown to the admin once); the API needs it to sign every delivery.
  secret text not null
);
create index webhook_subscription_tenant_idx on webhook_subscription (tenant_id) where deleted_at is null;
create trigger touch_updated_at before update on webhook_subscription for each row execute function touch_updated_at();
grant select, insert, update on webhook_subscription to tributary_app;

create table webhook_delivery (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  subscription_id uuid not null references webhook_subscription (id),
  event text not null,
  payload jsonb not null,
  status text not null check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0,
  response_status integer,
  error text,
  delivered_at timestamptz
);
create index webhook_delivery_subscription_idx on webhook_delivery (subscription_id, id desc);
create trigger touch_updated_at before update on webhook_delivery for each row execute function touch_updated_at();
grant select, insert, update on webhook_delivery to tributary_app;
