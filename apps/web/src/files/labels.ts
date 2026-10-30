import type { FileSummary, IngestStatus } from '@tributary/contracts';
import type { StatusTone } from '@tributary/ui';

export const STATUS_LABEL: Record<IngestStatus, string> = {
  registered: 'Registered',
  uploading: 'Uploading',
  uploaded: 'Checking…',
  type_detected: 'Checking…',
  contract_validated: 'Checking…',
  qc_passed: 'QC passed',
  qc_failed: 'QC failed',
  published: 'Published',
  rejected: 'Rejected',
};

export const STATUS_TONE: Record<IngestStatus, StatusTone> = {
  registered: 'pending',
  uploading: 'pending',
  uploaded: 'pending',
  type_detected: 'pending',
  contract_validated: 'pending',
  qc_passed: 'ok',
  qc_failed: 'error',
  published: 'ok',
  rejected: 'warning',
};

const FORMAT_LABEL: Record<string, string> = {
  fastq: 'FASTQ',
  vcf: 'VCF',
  bam: 'BAM',
  csv: 'CSV',
  tsv: 'TSV',
  parquet: 'Parquet',
  zip: 'zip',
  mzml: 'mzML',
  thermo_raw: 'Thermo RAW',
  bruker_tdf: 'Bruker TDF',
  bruker_tdf_bin: 'Bruker TDF data',
  bruker_baf: 'Bruker BAF',
  sciex_wiff: 'SCIEX WIFF',
  sciex_wiff_scan: 'SCIEX WIFF scan',
  text: 'Text',
  binary: 'Binary',
};

/** "FASTQ (gzip)" from the QC report; "—" before detection. */
export function formatLabel(file: FileSummary): string {
  const format = file.qc_report?.format ?? file.format;
  if (!format) return '—';
  const name = FORMAT_LABEL[format] ?? format;
  const compression = file.qc_report?.compression;
  return compression && compression !== 'none' ? `${name} (${compression})` : name;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 && unit ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
