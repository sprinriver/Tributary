import { TERMINAL_RUN_STATUSES, type RunStatus } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { insertAudit, type AuditActor } from '../audit.ts';

export interface StatusObservation {
  status: RunStatus;
  externalStatus: string;
  at: Date;
  source: 'api' | 'event' | 'poll';
  reason?: string | undefined;
}

const ACTIVE: RunStatus[] = ['starting', 'running', 'stopping'];

/**
 * Records a status observation and applies it (SPEC §7.4): idempotent per (run, external status, event time);
 * an older non-terminal observation is recorded but not applied; a terminal status is final. Returns whether the
 * run's status changed and its status afterwards.
 */
export async function applyRunStatus(
  db: Database,
  actor: AuditActor,
  runId: string,
  obs: StatusObservation,
): Promise<{ changed: boolean; status: RunStatus; previous: RunStatus }> {
  return db.transaction().execute(async (trx) => {
    const run = await trx
      .selectFrom('pipeline_run')
      .select(['id', 'tenant_id', 'status', 'status_at', 'started_at'])
      .where('id', '=', runId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const current = run.status as RunStatus;
    const terminal = TERMINAL_RUN_STATUSES.includes(current);
    const newer = !run.status_at || obs.at.getTime() >= new Date(run.status_at).getTime();
    const apply =
      !terminal && obs.status !== current && (newer || TERMINAL_RUN_STATUSES.includes(obs.status));
    const inserted = await trx
      .insertInto('pipeline_run_event')
      .values({
        tenant_id: run.tenant_id,
        created_by: actor.userId,
        pipeline_run_id: runId,
        status: obs.status,
        external_status: obs.externalStatus,
        event_time: obs.at,
        source: obs.source,
        reason: obs.reason ?? null,
        applied: apply,
      })
      .onConflict((oc) => oc.columns(['pipeline_run_id', 'external_status', 'event_time']).doNothing())
      .returning('id')
      .executeTakeFirst();
    if (!inserted || !apply) return { changed: false, status: current, previous: current };
    await trx
      .updateTable('pipeline_run')
      .set({
        status: obs.status,
        status_at: obs.at,
        status_reason: obs.reason ?? null,
        ...(ACTIVE.includes(obs.status) && !run.started_at ? { started_at: obs.at } : {}),
        ...(TERMINAL_RUN_STATUSES.includes(obs.status) ? { finished_at: obs.at } : {}),
      })
      .where('id', '=', runId)
      .execute();
    await insertAudit(trx, actor, {
      action: 'run.status',
      entityType: 'pipeline_run',
      entityId: runId,
      before: { status: current },
      after: { status: obs.status, external_status: obs.externalStatus, source: obs.source },
      reason: obs.reason ?? null,
    });
    return { changed: true, status: obs.status, previous: current };
  });
}
