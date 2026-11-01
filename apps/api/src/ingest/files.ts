import { QcReportSchema, type FileSummary, type QcReport } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { notFound } from '../errors.ts';

export const FILE_COLUMNS = [
  'f.id',
  'f.tenant_id',
  'f.experiment_version_id',
  'f.name',
  'f.role',
  'f.bucket',
  'f.key',
  'f.size_bytes',
  'f.sha256',
  'f.format',
  'f.declared_format',
  'f.ingest_status',
  'f.qc_report',
  'f.lifecycle_tag',
  'f.upload_id',
  'f.created_at',
  'f.updated_at',
] as const;

/** A file with its program (for authorisation) and version status. */
export async function loadFile(db: Database, id: string) {
  const row = await db
    .selectFrom('file_object as f')
    .innerJoin('experiment_version as v', 'v.id', 'f.experiment_version_id')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .select([...FILE_COLUMNS, 'e.program_id', 'v.status as version_status'])
    .where('f.id', '=', id)
    .where('f.deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row) throw notFound('File');
  return row;
}
export type LoadedFile = Awaited<ReturnType<typeof loadFile>>;

const asDate = (value: Date | string) => (value instanceof Date ? value.toISOString() : value);

export function qcReportOf(value: unknown): QcReport | null {
  const parsed = QcReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** First failed QC check, for lists and the launch gate. */
export const qcReason = (report: QcReport | null): string | null =>
  report?.checks.find((c) => !c.passed)?.message ?? null;

export function fileSummary(row: Omit<LoadedFile, 'program_id' | 'version_status'>): FileSummary {
  const report = qcReportOf(row.qc_report);
  return {
    id: row.id,
    experiment_version_id: row.experiment_version_id,
    name: row.name,
    role: row.role as FileSummary['role'],
    bucket: row.bucket,
    key: row.key,
    size_bytes: Number(row.size_bytes),
    sha256: row.sha256,
    format: row.format,
    declared_format: row.declared_format,
    ingest_status: row.ingest_status as FileSummary['ingest_status'],
    qc_reason: qcReason(report),
    qc_report: report,
    lifecycle_tag: row.lifecycle_tag,
    created_at: asDate(row.created_at),
    updated_at: asDate(row.updated_at),
  };
}

export async function versionFiles(db: Database, versionId: string): Promise<FileSummary[]> {
  const rows = await db
    .selectFrom('file_object as f')
    .select(FILE_COLUMNS)
    .where('f.experiment_version_id', '=', versionId)
    .where('f.deleted_at', 'is', null)
    .orderBy('f.created_at')
    .orderBy('f.id')
    .execute();
  return rows.map(fileSummary);
}
