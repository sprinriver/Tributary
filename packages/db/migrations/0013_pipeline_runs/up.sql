-- Phase 10: pipeline run status history (SPEC §7.4) and run outputs as files.

-- The fake runner is the in-process test double of the PipelineRunner interface (apps/api tests).
alter table pipeline_run drop constraint pipeline_run_runner_check;
alter table pipeline_run add constraint pipeline_run_runner_check
  check (runner in ('local', 'aws_batch', 'healthomics', 'fake'));
alter table pipeline_run
  -- Time of the event that set the current status (out-of-order events older than this are recorded, not applied).
  add column status_at timestamptz,
  add column status_reason text,
  -- Set once the outputs of a succeeded run were imported (makes duplicate success events harmless).
  add column outputs_processed_at timestamptz;

-- Every status observation, from events or polling. Idempotent: one row per (run, external status, event time).
create table pipeline_run_event (
  id uuid primary key default uuidv7(),
  tenant_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  pipeline_run_id uuid not null references pipeline_run (id),
  status text not null check (status in ('submitted', 'pending', 'starting', 'running', 'stopping', 'succeeded',
    'failed', 'cancelled')),
  external_status text not null,
  event_time timestamptz not null,
  source text not null check (source in ('api', 'event', 'poll')),
  reason text,
  applied boolean not null
);
create unique index pipeline_run_event_key on pipeline_run_event (pipeline_run_id, external_status, event_time);
create trigger touch_updated_at before update on pipeline_run_event for each row execute function touch_updated_at();

-- Run outputs are files of the run (published versions cannot gain files otherwise).
alter table file_object add column pipeline_run_id uuid references pipeline_run (id);
create index file_object_run_idx on file_object (pipeline_run_id) where pipeline_run_id is not null;
create or replace function guard_file_object_insert() returns trigger language plpgsql as $$
declare frozen uuid;
begin
  if new.experiment_version_id is null or new.pipeline_run_id is not null then return new; end if;
  select id into frozen from experiment_version where id = new.experiment_version_id and status <> 'draft';
  if frozen is not null then
    raise exception 'files cannot be added to experiment_version %: it is not a draft', frozen
      using errcode = 'TR409';
  end if;
  return new;
end
$$;

grant select, insert, update on pipeline_run_event to tributary_app;
