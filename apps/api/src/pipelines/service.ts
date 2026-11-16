import { TERMINAL_RUN_STATUSES, type RunnerKind } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { serviceActor } from '../ingest/state.ts';
import type { Storage } from '../storage.ts';
import { batchStatus, omicsStatus } from './aws.ts';
import { processRunOutputs } from './outputs.ts';
import type { Runners } from './runner.ts';
import { applyRunStatus, type StatusObservation } from './status.ts';
import { notifyRunStatus } from '../webhooks/dispatch.ts';
import { runFinished } from '../notifications/emit.ts';
import { emailUser } from '../notifications/email.ts';

export interface PipelineDeps {
  db: Database;
  config: ApiConfig;
  storage: Storage;
  fetch: typeof fetch;
  runners: Runners;
}

async function observe(deps: PipelineDeps, run: { id: string; tenant_id: string }, obs: StatusObservation) {
  const actor = { ...(await serviceActor(deps.db, run.tenant_id, 'pipelines')), requestId: `run:${run.id}` };
  const result = await applyRunStatus(deps.db, actor, run.id, obs);
  if (result.changed) void announce(deps, run, result.status, result.previous);
  if (result.status === 'succeeded') await processRunOutputs(deps, run.id);
  return result;
}

/** Run-status webhooks (SPEC M13). Delivery never blocks or fails status handling; outcomes are recorded. */
async function announce(
  deps: PipelineDeps,
  run: { id: string; tenant_id: string },
  status: string,
  previous: string,
) {
  try {
    const row = await deps.db
      .selectFrom('pipeline_run as r')
      .leftJoin('pipeline_definition as d', 'd.id', 'r.pipeline_definition_id')
      .select(['r.experiment_version_id', 'd.key'])
      .where('r.id', '=', run.id)
      .executeTakeFirst();
    await notifyRunStatus(
      { db: deps.db, fetch: deps.fetch, tenantId: run.tenant_id, production: deps.config.production },
      {
        run_id: run.id,
        status,
        previous_status: previous,
        pipeline_key: row?.key ?? null,
        experiment_version_id: row?.experiment_version_id ?? null,
      },
    );
    if (TERMINAL_RUN_STATUSES.includes(status as never)) {
      const actor = await serviceActor(deps.db, run.tenant_id, 'pipelines');
      await runFinished(deps, actor, run.id, status);
      // The person who launched the run hears about it by email.
      const launched = await deps.db
        .selectFrom('pipeline_run as r')
        .innerJoin('experiment_version as v', 'v.id', 'r.experiment_version_id')
        .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
        .select(['r.created_by', 'e.name', 'v.version_number'])
        .where('r.id', '=', run.id)
        .executeTakeFirst();
      if (launched)
        await emailUser(deps, actor, launched.created_by, 'run.finished', {
          subject: `your pipeline run on ${launched.name} v${launched.version_number} ${status}`,
          lines: [`The pipeline run you launched on ${launched.name} v${launched.version_number} ${status}.`],
          path: `/runs/${run.id}`,
        });
    }
  } catch {
    // Deliveries record their own failures; a lookup failure here must not affect the run.
  }
}

/** Poller fallback (SPEC M4): asks each runner for every non-terminal run's status. */
export async function pollRuns(deps: PipelineDeps): Promise<number> {
  const runs = await deps.db
    .selectFrom('pipeline_run')
    .select(['id', 'tenant_id', 'runner', 'external_id', 'status'])
    .where('deleted_at', 'is', null)
    .where((eb) =>
      eb.or([
        eb('status', 'not in', [...TERMINAL_RUN_STATUSES]),
        eb.and([eb('status', '=', 'succeeded'), eb('outputs_processed_at', 'is', null)]),
      ]),
    )
    .execute();
  let changed = 0;
  for (const run of runs) {
    const runner = deps.runners[run.runner as RunnerKind];
    if (!runner || !run.external_id) continue;
    if (TERMINAL_RUN_STATUSES.includes(run.status as never)) {
      if (run.status === 'succeeded') await processRunOutputs(deps, run.id);
      continue;
    }
    const status = await runner.getStatus(run.external_id);
    for (const earlier of status.history ?? []) {
      await observe(deps, run, {
        status: earlier.status,
        externalStatus: earlier.externalStatus,
        at: earlier.at ?? new Date(),
        source: 'poll',
      });
    }
    const result = await observe(deps, run, {
      status: status.status,
      externalStatus: status.externalStatus,
      at: status.at ?? new Date(),
      source: 'poll',
      reason: status.reason,
    });
    if (result.changed) changed++;
  }
  return changed;
}

interface EventBridgeMessage {
  source?: string;
  'detail-type'?: string;
  time?: string;
  detail?: { jobId?: string; runId?: string; status?: string; statusReason?: string };
}

/**
 * Applies one EventBridge state-change event (from SQS): aws.batch "Batch Job State Change" or aws.omics
 * "Run Status Change". Unknown runs are ignored (the queue may carry other jobs). `runner` overrides the mapping
 * (tests address the fake runner).
 */
export async function handleRunEvent(
  deps: PipelineDeps,
  message: EventBridgeMessage,
  runner?: RunnerKind,
): Promise<boolean> {
  const detail = message.detail ?? {};
  let kind: RunnerKind;
  let externalId: string | undefined;
  let status;
  if (message.source === 'aws.batch') {
    kind = 'aws_batch';
    externalId = detail.jobId;
    status = batchStatus(detail.status ?? '', detail.statusReason);
  } else if (message.source === 'aws.omics') {
    kind = 'healthomics';
    externalId = detail.runId;
    status = omicsStatus(detail.status ?? '');
  } else {
    return false;
  }
  if (!externalId || !detail.status || !message.time) return false;
  const run = await deps.db
    .selectFrom('pipeline_run')
    .select(['id', 'tenant_id'])
    .where('runner', '=', runner ?? kind)
    .where('external_id', '=', externalId)
    .executeTakeFirst();
  if (!run) return false;
  await observe(deps, run, {
    status,
    externalStatus: detail.status,
    at: new Date(message.time),
    source: 'event',
    reason: detail.statusReason,
  });
  return true;
}
