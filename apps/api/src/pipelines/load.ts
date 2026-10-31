import type { MyRun, RunDetail, RunSummary } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { notFound } from '../errors.ts';

const iso = (v: Date | string | null) => (v === null ? null : v instanceof Date ? v.toISOString() : v);

function base(db: Database) {
  return db
    .selectFrom('pipeline_run as r')
    .innerJoin('pipeline_definition as d', 'd.id', 'r.pipeline_definition_id')
    .innerJoin('experiment_version as v', 'v.id', 'r.experiment_version_id')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .select([
      'r.id',
      'r.pipeline_definition_id',
      'd.key as pipeline_key',
      'd.name as pipeline_name',
      'r.experiment_version_id',
      'r.runner',
      'r.external_id',
      'r.status',
      'r.status_reason',
      'r.created_at',
      'r.started_at',
      'r.finished_at',
      'r.params',
      'r.work_dir',
      'r.output_uri',
      'r.log_links',
      'r.cost_estimate',
      'r.triggered_by',
      'e.program_id',
      'e.id as experiment_id',
      'e.name as experiment_name',
    ])
    .where('r.deleted_at', 'is', null);
}
type Row = Awaited<ReturnType<ReturnType<typeof base>['executeTakeFirstOrThrow']>>;

const summary = (r: Row): RunSummary => ({
  id: r.id,
  pipeline_definition_id: r.pipeline_definition_id,
  pipeline_key: r.pipeline_key,
  pipeline_name: r.pipeline_name,
  experiment_version_id: r.experiment_version_id,
  runner: r.runner as RunSummary['runner'],
  external_id: r.external_id,
  status: r.status as RunSummary['status'],
  status_reason: r.status_reason,
  created_at: iso(r.created_at)!,
  started_at: iso(r.started_at),
  finished_at: iso(r.finished_at),
});

export async function versionRuns(db: Database, versionId: string): Promise<RunSummary[]> {
  const rows = await base(db)
    .where('r.experiment_version_id', '=', versionId)
    .orderBy('r.created_at', 'desc')
    .execute();
  return rows.map(summary);
}

/** Runs the user launched in the last 7 days, in programs they can still read. */
export async function myRuns(
  db: Database,
  userId: string,
  programs: readonly string[] | null,
): Promise<MyRun[]> {
  let q = base(db)
    .where('r.triggered_by', '=', userId)
    .where('r.created_at', '>', new Date(Date.now() - 7 * 24 * 3600 * 1000));
  if (programs !== null) {
    if (!programs.length) return [];
    q = q.where('e.program_id', 'in', programs);
  }
  const rows = await q.orderBy('r.created_at', 'desc').limit(50).execute();
  return rows.map((r) => ({
    ...summary(r),
    experiment_id: r.experiment_id,
    experiment_name: r.experiment_name,
  }));
}

export async function loadRun(db: Database, id: string): Promise<RunDetail & { program_id: string }> {
  const r = await base(db).where('r.id', '=', id).executeTakeFirst();
  if (!r) throw notFound('Run');
  const events = await db
    .selectFrom('pipeline_run_event')
    .select(['status', 'external_status', 'event_time', 'source', 'reason', 'applied'])
    .where('pipeline_run_id', '=', id)
    .orderBy('event_time')
    .orderBy('created_at')
    .execute();
  const outputs = await db
    .selectFrom('file_object as f')
    .leftJoin('dataset_release as rel', 'rel.file_id', 'f.id')
    .select([
      'f.id as file_id',
      'f.name',
      'f.ingest_status',
      'rel.id as release_id',
      'rel.status as release_status',
    ])
    .where('f.pipeline_run_id', '=', id)
    .orderBy('f.name')
    .execute();
  return {
    ...summary(r),
    program_id: r.program_id,
    params: r.params as RunDetail['params'],
    work_dir: r.work_dir,
    output_uri: r.output_uri,
    log_links: r.log_links as RunDetail['log_links'],
    cost_estimate: r.cost_estimate,
    triggered_by: r.triggered_by,
    events: events.map((e) => ({
      status: e.status as RunDetail['status'],
      external_status: e.external_status,
      at: iso(e.event_time)!,
      source: e.source as 'api' | 'event' | 'poll',
      reason: e.reason,
      applied: e.applied,
    })),
    outputs,
  };
}
