-- Read-only metadata kinds for the query service (SPEC §6.2, ARCHITECTURE §6): one view per kind with the
-- contract's columns plus program_id for scoping. Soft-deleted rows are left out. The query service reads them
-- as tributary_query_ro, which can read these views and nothing else.
create schema if not exists query_meta;

-- Ontology-typed values are stored as {id, label}; reserved tokens ("not applicable") as plain strings.
create or replace function query_meta.term_label(v jsonb) returns text language sql immutable as $$
  select case jsonb_typeof(v) when 'object' then v->>'label' when 'string' then v #>> '{}' end
$$;
create or replace function query_meta.num(v jsonb) returns double precision language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::double precision end
$$;
create or replace function query_meta.int(v jsonb) returns integer language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^-?[0-9]+$' then (v #>> '{}')::integer end
$$;

create or replace view query_meta.experiment_version as
select v.id as experiment_version_id, e.id as experiment_id, e.program_id, e.name as experiment_name,
  e.assay_type::text as assay_type, v.version_number, v.status::text as status, v.experiment_date,
  v.species->>'id' as species_id, v.species->>'label' as species_label, v.published_at, v.urn
from experiment_version v
join experiment e on e.id = v.experiment_id
where v.deleted_at is null and e.deleted_at is null;

create or replace view query_meta.sample as
select s.experiment_version_id, e.program_id, s.sample_key, s.source_name,
  query_meta.term_label(s.characteristics->'organism') as organism,
  s.characteristics->'organism'->>'id' as organism_id,
  query_meta.term_label(s.characteristics->'cell_line') as cell_line,
  s.characteristics->'cell_line'->>'id' as cell_line_id,
  query_meta.term_label(s.characteristics->'tissue') as tissue,
  s.characteristics->'tissue'->>'id' as tissue_id,
  query_meta.term_label(s.characteristics->'cell_type') as cell_type,
  s.characteristics->'cell_type'->>'id' as cell_type_id,
  query_meta.term_label(s.characteristics->'disease') as disease,
  s.characteristics->'disease'->>'id' as disease_id,
  s.factors->>'compound_id' as compound_id, s.factors->>'vehicle' as vehicle,
  query_meta.num(s.factors->'dose_molar') as dose_molar, s.factors->>'dose_display' as dose_display,
  query_meta.num(s.factors->'time_hours') as time_hours, s.factors->>'time_display' as time_display,
  s.factors->>'condition' as condition,
  s.factors->>'replicate_group' as replicate_group,
  query_meta.int(s.factors->'biological_replicate') as biological_replicate,
  query_meta.int(s.factors->'technical_replicate') as technical_replicate,
  s.technical->>'plate' as plate, s.technical->>'well' as well, s.technical->>'fraction' as fraction,
  s.technical->>'label_channel' as label_channel, s.technical->>'instrument_run' as instrument_run,
  s.technical->>'raw_file' as raw_file,
  s.position
from sample s
join experiment_version v on v.id = s.experiment_version_id
join experiment e on e.id = v.experiment_id
where s.deleted_at is null and v.deleted_at is null and e.deleted_at is null;

create or replace view query_meta.file_object as
select f.id as file_id, f.experiment_version_id, e.program_id, f.bucket, f.key, f.sha256, f.size_bytes,
  f.format, f.ingest_status::text as ingest_status, f.created_at
from file_object f
join experiment_version v on v.id = f.experiment_version_id
join experiment e on e.id = v.experiment_id
where f.deleted_at is null and v.deleted_at is null and e.deleted_at is null;

create or replace view query_meta.pipeline_run as
select r.id as pipeline_run_id, r.experiment_version_id, e.program_id, d.key as pipeline_key, r.runner,
  r.status::text as status, r.started_at, r.finished_at, r.triggered_by
from pipeline_run r
join pipeline_definition d on d.id = r.pipeline_definition_id
join experiment_version v on v.id = r.experiment_version_id
join experiment e on e.id = v.experiment_id
where r.deleted_at is null and v.deleted_at is null and e.deleted_at is null;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tributary_query_ro') then
    create role tributary_query_ro nologin;
  end if;
end
$$;
grant usage on schema query_meta to tributary_query_ro;
grant select on all tables in schema query_meta to tributary_query_ro;
grant execute on all functions in schema query_meta to tributary_query_ro;
