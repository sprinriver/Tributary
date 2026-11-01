drop schema if exists query_meta cascade;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'tributary_query_ro') then
    drop owned by tributary_query_ro;
    drop role tributary_query_ro;
  end if;
end
$$;
