-- Phase 18 lineage (SPEC M10, ADR 0021): every edge of the lineage graph in one view (schema `lineage`). Explicit lineage_edge rows
-- (recorded when a run is launched or collects outputs) are merged with relations that foreign keys already
-- state, so lineage is complete for data created before edges were recorded and cannot drift from the records.
create schema if not exists lineage;
grant usage on schema lineage to tributary_app;

create or replace view lineage.link as
-- Recorded edges.
select fn.kind as from_kind, fn.entity_id as from_id, e.relation, tn.kind as to_kind, tn.entity_id as to_id
from lineage_edge e
join lineage_node fn on fn.id = e.from_node_id and fn.deleted_at is null
join lineage_node tn on tn.id = e.to_node_id and tn.deleted_at is null
where e.deleted_at is null
union
-- A release was imported from a file.
select 'file', r.file_id, 'input_to', 'dataset_release', r.id
from dataset_release r
where r.file_id is not null and r.deleted_at is null
union
-- A release belongs to (describes) an experiment version.
select 'experiment_version', d.experiment_version_id, 'describes', 'dataset_release', r.id
from dataset_release r
join dataset d on d.id = r.dataset_id
where d.experiment_version_id is not null and r.deleted_at is null and d.deleted_at is null
union
-- A run was launched on an experiment version.
select 'experiment_version', p.experiment_version_id, 'input_to', 'pipeline_run', p.id
from pipeline_run p
where p.deleted_at is null
union
-- A run produced a file.
select 'pipeline_run', f.pipeline_run_id, 'produced', 'file', f.id
from file_object f
where f.pipeline_run_id is not null and f.deleted_at is null
union
-- A saved chart reads releases (its source and joins).
select 'dataset_release', refs.release_id::uuid, 'input_to', 'chart', v.id
from saved_view v
cross join lateral (
  select jsonb_array_elements_text(v.query_spec -> 'source' -> 'releaseIds') as release_id
  union
  select jsonb_array_elements_text(j -> 'target' -> 'releaseIds')
  from jsonb_array_elements(coalesce(v.query_spec -> 'joins', '[]'::jsonb)) as j
) as refs
where v.chart_spec is not null and v.deleted_at is null;

grant select on lineage.link to tributary_app;
