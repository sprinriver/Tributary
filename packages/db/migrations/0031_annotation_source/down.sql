drop index if exists target_annotation_source_idx;
alter table target_annotation
  drop column retrieved_at,
  drop column source_release,
  drop column source;
