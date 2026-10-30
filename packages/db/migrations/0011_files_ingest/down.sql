drop table if exists lifecycle_policy, qc_override;
drop trigger if exists guard_file_object_insert on file_object;
drop function if exists guard_file_object_insert();
drop index if exists file_object_version_idx;
update file_object set sha256 = repeat('0', 64) where sha256 is null;
alter table file_object
  alter column sha256 set not null,
  drop column if exists lifecycle_tag,
  drop column if exists upload_id,
  drop column if exists role,
  drop column if exists name,
  drop column if exists experiment_version_id;
