-- The role is cluster-wide: drop only this database's privileges, then the role if nothing else uses it.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tributary_app') then
    execute 'drop owned by tributary_app';
    begin
      execute 'drop role tributary_app';
    exception when dependent_objects_still_exist then
      raise notice 'tributary_app is still used by another database; keeping the role';
    end;
  end if;
end
$$;
