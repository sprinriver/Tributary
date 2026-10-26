import {
  crisprGeneSummary,
  differentialAbundance,
  doseResponse,
  precursorQuant,
  proteinQuant,
  qcMetrics,
  rnaseqCounts,
} from './experiment.ts';
import { experimentVersionMeta, fileObjectMeta, pipelineRunMeta, sampleMeta } from './metadata.ts';
import { compound, compoundProperty, idMapping, targetAnnotation } from './reference.ts';
import type { DatasetContract, DatasetKind } from './types.ts';

export * from './types.ts';

export const DATASET_CONTRACTS: Readonly<Record<DatasetKind, DatasetContract>> = {
  protein_quant: proteinQuant,
  precursor_quant: precursorQuant,
  differential_abundance: differentialAbundance,
  dose_response: doseResponse,
  qc_metrics: qcMetrics,
  rnaseq_counts: rnaseqCounts,
  crispr_gene_summary: crisprGeneSummary,
  compound,
  compound_property: compoundProperty,
  target_annotation: targetAnnotation,
  id_mapping: idMapping,
  experiment_version: experimentVersionMeta,
  sample: sampleMeta,
  file_object: fileObjectMeta,
  pipeline_run: pipelineRunMeta,
};
