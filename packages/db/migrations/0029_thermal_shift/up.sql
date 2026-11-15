-- Phase 46: the thermal_shift dataset kind (thermal proteome profiling results; packages/contracts datasets).
alter table dataset drop constraint dataset_kind_check;
alter table dataset add constraint dataset_kind_check check (kind in ('protein_quant', 'precursor_quant',
  'differential_abundance', 'dose_response', 'thermal_shift', 'qc_metrics', 'rnaseq_counts', 'crispr_gene_summary',
  'compound', 'compound_property', 'target_annotation', 'id_mapping', 'experiment_version', 'sample',
  'file_object', 'pipeline_run'));
