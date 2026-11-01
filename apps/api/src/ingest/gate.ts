import { INGEST_IN_PROGRESS, type IngestStatus, type QcGate, type QcOverride } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { qcReason, qcReportOf } from './files.ts';

/** The latest QC override for a version (with its approver's name). */
export async function latestOverride(db: Database, versionId: string): Promise<QcOverride | null> {
  const row = await db
    .selectFrom('qc_override as o')
    .leftJoin('app_user as u', 'u.id', 'o.created_by')
    .select([
      'o.id',
      'o.experiment_version_id',
      'o.reason',
      'o.file_ids',
      'o.created_by',
      'o.created_at',
      'u.name',
    ])
    .where('o.experiment_version_id', '=', versionId)
    .where('o.deleted_at', 'is', null)
    .orderBy('o.created_at', 'desc')
    .orderBy('o.id', 'desc')
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    experiment_version_id: row.experiment_version_id,
    reason: row.reason,
    file_ids: row.file_ids,
    created_by: row.created_by,
    created_by_name: row.name,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

/**
 * SPEC M3 QC gate: a pipeline may launch for a version only when none of its files is still being ingested and
 * every `qc_failed` file is covered by an approver override. Enforced at launch (Phase 10) and shown in the UI.
 */
export async function canLaunch(db: Database, versionId: string): Promise<QcGate> {
  const files = await db
    .selectFrom('file_object')
    .select(['id', 'name', 'ingest_status', 'qc_report'])
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .where('ingest_status', '!=', 'rejected')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const override = await latestOverride(db, versionId);
  const covered = new Set(override?.file_ids ?? []);
  const blockers: QcGate['blockers'] = [];
  const overridden: string[] = [];
  for (const f of files) {
    const status = f.ingest_status as IngestStatus;
    if (INGEST_IN_PROGRESS.includes(status)) {
      blockers.push({ file_id: f.id, name: f.name, status, reason: 'Ingest and QC have not finished yet.' });
    } else if (status === 'qc_failed') {
      if (covered.has(f.id)) overridden.push(f.id);
      else {
        const reason = qcReason(qcReportOf(f.qc_report)) ?? 'QC failed.';
        blockers.push({ file_id: f.id, name: f.name, status, reason });
      }
    }
  }
  return { can_launch: blockers.length === 0, blockers, overridden, override };
}

/** Failed files an override would cover now. */
export async function failedFiles(db: Database, versionId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('file_object')
    .select('id')
    .where('experiment_version_id', '=', versionId)
    .where('deleted_at', 'is', null)
    .where('ingest_status', '=', 'qc_failed')
    .orderBy('created_at')
    .execute();
  return rows.map((r) => r.id);
}
