-- The demo seed created its own account as a person; it is a service (Phase 36: usage counts people only).
update app_user set kind = 'service' where sub = 'service:db-seed' and kind = 'human';
