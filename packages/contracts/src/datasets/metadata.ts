import { col, opt } from './types.ts';
import type { DatasetContract } from './types.ts';

// Read-only metadata kinds: served live from program-scoped Postgres views (ARCHITECTURE §6).

export const experimentVersionMeta: DatasetContract = {
  kind: 'experiment_version',
  version: '1.0.0',
  category: 'metadata',
  description: 'Experiment versions with their experiment and program.',
  columns: [
    col('experiment_version_id', 'uuid'),
    col('experiment_id', 'uuid'),
    col('program_id', 'uuid'),
    col('experiment_name', 'text'),
    col('assay_type', 'text'),
    col('version_number', 'integer'),
    col('status', 'text'),
    opt('experiment_date', 'date'),
    opt('species_id', 'text'),
    opt('species_label', 'text'),
    opt('published_at', 'timestamp'),
    col('urn', 'text'),
  ],
  joinKeys: ['experiment_version_id'],
  qualityRules: [],
};

export const sampleMeta: DatasetContract = {
  kind: 'sample',
  // 1.1.0: ontology ids, time_display (keeps reserved tokens such as "not applicable") and raw_file (additive).
  version: '1.1.0',
  category: 'metadata',
  description: 'Samples with characteristics and factors flattened to columns.',
  columns: [
    col('experiment_version_id', 'uuid'),
    col('sample_key', 'text'),
    opt('source_name', 'text'),
    opt('organism', 'text', { description: 'Ontology label, or the reserved token as written' }),
    opt('organism_id', 'text', { description: 'NCBITaxon CURIE' }),
    opt('cell_line', 'text'),
    opt('cell_line_id', 'text'),
    opt('tissue', 'text'),
    opt('tissue_id', 'text'),
    opt('cell_type', 'text'),
    opt('cell_type_id', 'text'),
    opt('disease', 'text'),
    opt('disease_id', 'text'),
    opt('compound_id', 'text'),
    opt('vehicle', 'text'),
    opt('dose_molar', 'double', { unit: 'M' }),
    opt('dose_display', 'text'),
    opt('time_hours', 'double', { unit: 'h' }),
    opt('time_display', 'text'),
    opt('condition', 'text'),
    opt('replicate_group', 'text'),
    opt('biological_replicate', 'integer'),
    opt('technical_replicate', 'integer'),
    opt('plate', 'text'),
    opt('well', 'text'),
    opt('fraction', 'text'),
    opt('label_channel', 'text'),
    opt('instrument_run', 'text'),
    opt('raw_file', 'text'),
  ],
  joinKeys: ['experiment_version_id', 'sample_key', 'compound_id'],
  qualityRules: [],
};

export const fileObjectMeta: DatasetContract = {
  kind: 'file_object',
  version: '1.0.0',
  category: 'metadata',
  description: 'Uploaded and pipeline-produced files.',
  columns: [
    col('file_id', 'uuid'),
    opt('experiment_version_id', 'uuid'),
    col('bucket', 'text'),
    col('key', 'text'),
    col('sha256', 'text'),
    col('size_bytes', 'integer'),
    opt('format', 'text'),
    col('ingest_status', 'text'),
    col('created_at', 'timestamp'),
  ],
  joinKeys: ['experiment_version_id'],
  qualityRules: [],
};

export const pipelineRunMeta: DatasetContract = {
  kind: 'pipeline_run',
  version: '1.0.0',
  category: 'metadata',
  description: 'Pipeline runs and their status.',
  columns: [
    col('pipeline_run_id', 'uuid'),
    col('experiment_version_id', 'uuid'),
    col('pipeline_key', 'text'),
    col('runner', 'text'),
    col('status', 'text'),
    opt('started_at', 'timestamp'),
    opt('finished_at', 'timestamp'),
    col('triggered_by', 'uuid'),
  ],
  joinKeys: ['experiment_version_id'],
  qualityRules: [],
};
