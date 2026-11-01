-- updated_at maintenance, immutability of published things (SPEC §4) and an append-only audit log.
-- Violations raise SQLSTATE TR409, which apps/api maps to HTTP 409.

do $$
declare t text;
begin
  foreach t in array array['program', 'assay_type', 'metadata_template', 'metadata_field_def', 'experiment',
    'experiment_version', 'sample', 'contrast', 'file_object', 'sample_file', 'dataset', 'dataset_release',
    'pipeline_definition', 'pipeline_run', 'compound', 'compound_property', 'target_annotation', 'app_user',
    'app_group', 'group_member', 'role_binding', 'saved_view', 'lineage_node', 'lineage_edge']
  loop
    execute format('create trigger touch_updated_at before update on %I for each row execute function touch_updated_at()', t);
  end loop;
end
$$;

-- URNs are derived from ids (SPEC §4), never taken from the caller: urn:tributary:experiment:<id>[:v<n>].
create function set_experiment_urn() returns trigger language plpgsql as $$
begin
  new.urn := 'urn:tributary:experiment:' || new.id;
  return new;
end
$$;
create trigger set_urn before insert or update on experiment
  for each row execute function set_experiment_urn();

create function set_experiment_version_urn() returns trigger language plpgsql as $$
begin
  select urn || ':v' || new.version_number into new.urn from experiment where id = new.experiment_id;
  return new;
end
$$;
create trigger set_urn before insert or update on experiment_version
  for each row execute function set_experiment_version_urn();

-- Published versions are frozen. A published version may only move to archived (nothing else changing);
-- archived is final. Generated/derived columns (search_tsv, embedding) may still be refreshed.
create function guard_experiment_version() returns trigger language plpgsql as $$
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
create trigger guard_experiment_version before update or delete on experiment_version
  for each row execute function guard_experiment_version();

-- Rows that belong to an experiment version (samples, contrasts, custom fields) change only while it is a draft.
create function guard_version_children() returns trigger language plpgsql as $$
declare
  version_ids uuid[];
  frozen uuid;
begin
  version_ids := case tg_op
    when 'INSERT' then array[new.experiment_version_id]
    when 'DELETE' then array[old.experiment_version_id]
    else array[old.experiment_version_id, new.experiment_version_id] end;
  select id into frozen from experiment_version where id = any(version_ids) and status <> 'draft' limit 1;
  if frozen is not null then
    raise exception '% rows of experiment_version % cannot change: it is not a draft', tg_table_name, frozen
      using errcode = 'TR409';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger guard_version_children before insert or update or delete on sample
  for each row execute function guard_version_children();
create trigger guard_version_children before insert or update or delete on contrast
  for each row execute function guard_version_children();
create trigger guard_version_children before insert or update or delete on metadata_field_def
  for each row execute function guard_version_children();

-- Sample files follow their sample's version.
create function guard_sample_file() returns trigger language plpgsql as $$
declare frozen uuid;
begin
  select v.id into frozen
  from sample s join experiment_version v on v.id = s.experiment_version_id
  where s.id in (coalesce(new.sample_id, old.sample_id), coalesce(old.sample_id, new.sample_id))
    and v.status <> 'draft'
  limit 1;
  if frozen is not null then
    raise exception 'sample_file rows of experiment_version % cannot change: it is not a draft', frozen
      using errcode = 'TR409';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger guard_sample_file before insert or update or delete on sample_file
  for each row execute function guard_sample_file();

-- Releases are staged, then published or rejected; after that they never change.
create function guard_dataset_release() returns trigger language plpgsql as $$
begin
  if old.status in ('published', 'rejected') then
    raise exception 'dataset_release % is %, and released data is immutable', old.id, old.status
      using errcode = 'TR409';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;
create trigger guard_dataset_release before update or delete on dataset_release
  for each row execute function guard_dataset_release();

create function reject_audit_change() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'TR409';
end
$$;
create trigger audit_log_append_only before update or delete on audit_log
  for each row execute function reject_audit_change();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function reject_audit_change();
