drop trigger if exists audit_log_no_truncate on audit_log;
drop trigger if exists audit_log_append_only on audit_log;
drop function if exists reject_audit_change();
drop trigger if exists guard_dataset_release on dataset_release;
drop function if exists guard_dataset_release();
drop trigger if exists guard_sample_file on sample_file;
drop function if exists guard_sample_file();
drop trigger if exists guard_version_children on metadata_field_def;
drop trigger if exists guard_version_children on contrast;
drop trigger if exists guard_version_children on sample;
drop function if exists guard_version_children();
drop trigger if exists guard_experiment_version on experiment_version;
drop trigger if exists set_urn on experiment_version;
drop function if exists set_experiment_version_urn();
drop trigger if exists set_urn on experiment;
drop function if exists set_experiment_urn();
drop function if exists guard_experiment_version();

do $$
declare t text;
begin
  foreach t in array array['program', 'assay_type', 'metadata_template', 'metadata_field_def', 'experiment',
    'experiment_version', 'sample', 'contrast', 'file_object', 'sample_file', 'dataset', 'dataset_release',
    'pipeline_definition', 'pipeline_run', 'compound', 'compound_property', 'target_annotation', 'app_user',
    'app_group', 'group_member', 'role_binding', 'saved_view', 'lineage_node', 'lineage_edge']
  loop
    execute format('drop trigger if exists touch_updated_at on %I', t);
  end loop;
end
$$;
