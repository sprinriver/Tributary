-- Phase 34 personal email (MAIL-01…03): each person's choices, and an outbox of emails a background sweep sends.

create table notification_preference (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  user_id uuid not null unique references app_user (id),
  email boolean not null default true,
  events text[] not null
);
create trigger touch_updated_at before update on notification_preference for each row execute function touch_updated_at();
grant select, insert, update on notification_preference to tributary_app;

create table email_delivery (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  user_id uuid not null references app_user (id),
  event text not null,
  to_address text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'delivered', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  error text,
  delivered_at timestamptz
);
create index email_delivery_due_idx on email_delivery (next_attempt_at) where status = 'pending';
create trigger touch_updated_at before update on email_delivery for each row execute function touch_updated_at();
grant select, insert, update on email_delivery to tributary_app;
