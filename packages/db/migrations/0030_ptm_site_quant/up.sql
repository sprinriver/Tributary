-- Phase 47: the ptm_site_quant dataset kind (modification sites; packages/contracts datasets).
alter table dataset drop constraint dataset_kind_check;
alter table dataset add constraint dataset_kind_check check (kind in ('protein_quant', 'precursor_quant',
  'differential_abundance', 'dose_response', 'thermal_shift', 'ptm_site_quant', 'qc_metrics', 'rnaseq_counts', 'crispr_gene_summary',
  'compound', 'compound_property', 'target_annotation', 'id_mapping', 'experiment_version', 'sample',
  'file_object', 'pipeline_run'));
