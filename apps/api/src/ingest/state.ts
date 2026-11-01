import { canTransition, type IngestStatus } from '@tributary/contracts';
import type { DB } from '@tributary/db';
import type { Kysely, Transaction } from 'kysely';
import { insertAudit, type AuditActor } from '../audit.ts';
import { HttpError, notFound } from '../errors.ts';

type Db = Kysely<DB> | Transaction<DB>;

/** Finds or creates the service account a background job acts as (`app_user.kind = 'service'`). */
export async function serviceActor(db: Kysely<DB>, tenantId: string, name: string): Promise<AuditActor> {
  const sub = `service|${name}`;
  await db
    .insertInto('app_user')
    .values({
      tenant_id: tenantId,
      created_by: tenantId,
      sub,
      email: `${name}@service.invalid`,
      name,
      kind: 'service',
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'sub']).doNothing())
    .execute();
  const user = await db
    .selectFrom('app_user')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('sub', '=', sub)
    .executeTakeFirstOrThrow();
  return { tenantId, userId: user.id, kind: 'service', requestId: `job:${name}`, ip: null, reason: null };
}

export interface TransitionOptions {
  reason?: string | null;
  /** Extra columns to set with the status (e.g. sha256, qc_report). */
  set?: Partial<{
    sha256: string;
    size_bytes: number;
    format: string;
    qc_report: string;
    lifecycle_tag: string;
    upload_id: string | null;
  }>;
  /** Recorded in the audit row's `after`. */
  details?: Record<string, unknown>;
}

/**
 * Moves a file to `to` if SPEC §7.3 allows it from its current status; otherwise 409 `illegal_transition`. Locks the
 * row, updates it and writes the audit row in one transaction (or the caller's).
 */
export async function transitionFile(
  db: Db,
  actor: AuditActor,
  fileId: string,
  to: IngestStatus,
  options: TransitionOptions = {},
): Promise<void> {
  const run = async (trx: Transaction<DB>) => {
    const row = await trx
      .selectFrom('file_object')
      .select(['id', 'ingest_status'])
      .where('id', '=', fileId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound('File');
    const from = row.ingest_status as IngestStatus;
    if (!canTransition(from, to)) {
      throw new HttpError(
        409,
        'illegal_transition',
        `A file cannot move from ${from} to ${to}.`,
        'ingest_status',
      );
    }
    await trx
      .updateTable('file_object')
      .set({ ingest_status: to, ...options.set })
      .where('id', '=', fileId)
      .execute();
    await insertAudit(trx, actor, {
      action: 'file.transition',
      entityType: 'file_object',
      entityId: fileId,
      before: { ingest_status: from },
      after: { ingest_status: to, ...options.details },
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
    });
  };
  if (db.isTransaction) await run(db as Transaction<DB>);
  else await (db as Kysely<DB>).transaction().execute(run);
}
