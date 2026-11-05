-- Phase 35 SCIM provisioning (SCIM-01…04): IdP-managed users and groups.

-- SCIM identity of a user, and deactivation (no access while set; reversible, unlike deleted_at).
alter table app_user add column scim_user_name text;
alter table app_user add column scim_external_id text;
alter table app_user add column deactivated_at timestamptz;
create unique index app_user_scim_user_name_idx on app_user (tenant_id, lower(scim_user_name))
  where deleted_at is null and scim_user_name is not null;

alter table app_group add column scim_external_id text;

-- Who manages a membership: the sign-in groups claim ('login') or SCIM ('scim'). Each only changes its own.
alter table group_member add column source text not null default 'login' check (source in ('login', 'scim'));

-- Tokens may carry the 'scim' scope (system admins' provisioning tokens).
alter table access_token drop constraint access_token_scopes_check;
alter table access_token add constraint access_token_scopes_check
  check (scopes <@ array['read', 'write', 'scim']::text[] and cardinality(scopes) > 0);
