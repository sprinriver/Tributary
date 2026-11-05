alter table access_token drop constraint access_token_scopes_check;
alter table access_token add constraint access_token_scopes_check
  check (scopes <@ array['read', 'write']::text[] and cardinality(scopes) > 0);
alter table group_member drop column source;
alter table app_group drop column scim_external_id;
drop index if exists app_user_scim_user_name_idx;
alter table app_user drop column deactivated_at;
alter table app_user drop column scim_external_id;
alter table app_user drop column scim_user_name;
