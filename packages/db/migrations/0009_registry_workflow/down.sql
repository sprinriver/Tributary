drop trigger if exists maintain_latest_published on experiment_version;
drop function if exists maintain_latest_published();
drop function if exists refresh_latest_published(uuid);

create or replace function guard_experiment_version() returns trigger language plpgsql as $$
declare
  ignored text[] := array['status', 'updated_at', 'search_tsv', 'embedding'];
begin
  if old.status = 'draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'experiment_version % is %, and published versions are immutable', old.id, old.status
      using errcode = 'TR409';
  end if;
  if (to_jsonb(new) - ignored) is distinct from (to_jsonb(old) - ignored)
     or (old.status = 'archived' and new.status <> 'archived')
     or (old.status = 'published' and new.status not in ('published', 'archived')) then
    raise exception 'experiment_version % is %; create a new version instead', old.id, old.status
      using errcode = 'TR409';
  end if;
  return new;
end
$$;

drop index if exists experiment_version_one_latest;
alter table experiment_version drop column if exists is_latest_published;
alter table sample drop column if exists position;
alter table sample drop column if exists raw;
alter table experiment drop column if exists archived_at;
alter table program drop column if exists requires_approval;
