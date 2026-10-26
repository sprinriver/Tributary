-- The role apps/api and workers use (a login user is granted this role per environment).
-- Soft delete only: no DELETE or TRUNCATE anywhere. audit_log: INSERT and SELECT only.
-- New tables must add their own grants in their migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tributary_app') then
    create role tributary_app nologin;
  end if;
end
$$;

grant usage on schema public to tributary_app;
grant select, insert, update on program, assay_type, metadata_template, metadata_field_def, experiment,
  experiment_version, sample, contrast, file_object, sample_file, dataset, dataset_release, pipeline_definition,
  pipeline_run, compound, compound_property, target_annotation, app_user, app_group, group_member, role_binding,
  saved_view, lineage_node, lineage_edge to tributary_app;
grant select, insert on audit_log to tributary_app;
grant execute on function uuidv7() to tributary_app;
