drop table if exists import_preset;
drop index if exists dataset_identity_key;
drop index if exists dataset_release_file_idx;
drop index if exists dataset_release_dataset_idx;
alter table dataset_release
  drop column if exists status_reason,
  drop column if exists validation,
  drop column if exists file_id,
  drop column if exists importer;
