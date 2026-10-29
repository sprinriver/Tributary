drop table if exists access_token, app_session;
alter table app_user drop column if exists kind;
