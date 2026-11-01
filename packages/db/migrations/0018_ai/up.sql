-- Phase 19 AI assistant (SPEC M12, §11): conversations and their messages. Token use per month is summed from
-- the assistant messages, so the budget needs no separate counter.

create table ai_conversation (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Conversations are private to the user who started them.
  user_id uuid not null references app_user (id),
  title text not null default ''
);
create index ai_conversation_user_idx on ai_conversation (tenant_id, user_id) where deleted_at is null;
create trigger touch_updated_at before update on ai_conversation for each row execute function touch_updated_at();
grant select, insert, update on ai_conversation to tributary_app;

create table ai_message (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  conversation_id uuid not null references ai_conversation (id),
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  tool_calls jsonb not null default '[]',
  provenance jsonb,
  refusal jsonb,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0)
);
create index ai_message_conversation_idx on ai_message (conversation_id, id);
create index ai_message_usage_idx on ai_message (tenant_id, created_at) where role = 'assistant';
create trigger touch_updated_at before update on ai_message for each row execute function touch_updated_at();
grant select, insert, update on ai_message to tributary_app;
