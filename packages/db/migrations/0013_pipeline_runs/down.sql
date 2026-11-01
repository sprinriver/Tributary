create or replace function guard_file_object_insert() returns trigger language plpgsql as $$
declare frozen uuid;
begin
  if new.experiment_version_id is null then return new; end if;
  select id into frozen from experiment_version where id = new.experiment_version_id and status <> 'draft';
  if frozen is not null then
    raise exception 'files cannot be added to experiment_version %: it is not a draft', frozen
      using errcode = 'TR409';
  end if;
  return new;
end
$$;
drop index if exists file_object_run_idx;
alter table file_object drop column if exists pipeline_run_id;
drop table if exists pipeline_run_event;
alter table pipeline_run drop column if exists outputs_processed_at, drop column if exists status_reason,
  drop column if exists status_at;
alter table pipeline_run drop constraint pipeline_run_runner_check;
alter table pipeline_run add constraint pipeline_run_runner_check check (runner in ('local', 'aws_batch', 'healthomics'));
