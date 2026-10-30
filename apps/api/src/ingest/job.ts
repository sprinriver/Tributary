import type { FileFormat, IngestStatus, QcCheck, QcReport } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { Storage } from '../storage.ts';
import { inspectObject } from './inspect.ts';
import { lifecycleTags } from './lifecycle.ts';
import { serviceActor, transitionFile } from './state.ts';

export interface IngestDeps {
  db: Database;
  storage: Storage;
}

/** Statuses the job (re)starts from; a crash mid-way resumes from the recorded status. */
const RUNNABLE: IngestStatus[] = ['uploaded', 'type_detected', 'contract_validated'];

const CONTRACT_SOURCE = 'Upload registration (declared format and size)';

function contractChecks(
  file: { declared_format: string | null; size_bytes: number | string },
  format: FileFormat,
  size: number,
): QcCheck[] {
  const checks: QcCheck[] = [];
  if (file.declared_format) {
    const ok = file.declared_format === format;
    checks.push({
      id: 'contract.declared_format',
      passed: ok,
      message: ok
        ? `Content matches the declared format ${format}.`
        : `Declared ${file.declared_format}, but the content is ${format}.`,
      source: CONTRACT_SOURCE,
    });
  }
  const registered = Number(file.size_bytes);
  checks.push({
    id: 'contract.size',
    passed: registered === size,
    message:
      registered === size
        ? 'The stored size matches the registered size.'
        : `Registered ${registered} bytes, but the object has ${size} bytes.`,
    source: CONTRACT_SOURCE,
  });
  return checks;
}

/**
 * The ingest job for one file (SPEC M3, §7.3): stream the object once (sha256, detection, QC), apply lifecycle tags,
 * then record uploaded → type_detected → contract_validated → qc_passed | qc_failed, each transition audited as the
 * ingest service account. Idempotent: finished files are left alone.
 */
export async function runIngest(
  { db, storage }: IngestDeps,
  fileId: string,
): Promise<IngestStatus | undefined> {
  const file = await db
    .selectFrom('file_object')
    .select(['id', 'tenant_id', 'bucket', 'key', 'role', 'declared_format', 'size_bytes', 'ingest_status'])
    .where('id', '=', fileId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!file || !RUNNABLE.includes(file.ingest_status as IngestStatus))
    return file?.ingest_status as IngestStatus;

  const inspection = await inspectObject(await storage.read(file.key, file.bucket), file.key);
  const contract = contractChecks(file, inspection.format, inspection.size_bytes);
  const contractOk = contract.every((c) => c.passed);
  const checks = [...contract, ...inspection.checks];
  const report: QcReport = {
    format: inspection.format,
    compression: inspection.compression,
    detected_by: inspection.detected_by,
    sha256: inspection.sha256,
    size_bytes: inspection.size_bytes,
    checks,
    passed: checks.every((c) => c.passed),
    checked_at: new Date().toISOString(),
  };
  const { tag, tags } = await lifecycleTags(db, file.tenant_id, file.role);
  await storage.tag(file.key, tags, file.bucket);

  const actor = await serviceActor(db, file.tenant_id, 'ingest');
  const final: IngestStatus = report.passed ? 'qc_passed' : 'qc_failed';
  await db.transaction().execute(async (trx) => {
    let status = file.ingest_status as IngestStatus;
    if (status === 'uploaded') {
      await transitionFile(trx, actor, fileId, 'type_detected', {
        set: { format: inspection.format, sha256: inspection.sha256, lifecycle_tag: tag },
        details: {
          format: inspection.format,
          compression: inspection.compression,
          sha256: inspection.sha256,
        },
      });
      status = 'type_detected';
    }
    const done = { set: { qc_report: JSON.stringify(report) }, details: { qc_passed: report.passed } };
    if (status === 'type_detected' && !contractOk) {
      await transitionFile(trx, actor, fileId, 'qc_failed', done);
      return;
    }
    if (status === 'type_detected') {
      await transitionFile(trx, actor, fileId, 'contract_validated');
    }
    await transitionFile(trx, actor, fileId, final, done);
  });
  return contractOk ? final : 'qc_failed';
}
