// Writes notification deliveries to the outbox (Phase 31, NOTIF-02). Called after a change is committed; best
// effort: a failure here is logged and never fails the change. Sending happens later, in sweep.ts.
import type { NotificationEvent } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyBaseLogger } from 'fastify';
import type { ApiConfig } from '../config.ts';
import type { Message } from './format.ts';

export interface Actor {
  tenantId: string;
  userId: string;
}

interface Pending {
  event: NotificationEvent;
  programId: string;
  title: string;
  lines: string[];
  /** App path the message links to, e.g. /releases/<id>. */
  path: string;
}

async function enqueue(db: Database, config: ApiConfig, actor: Actor, p: Pending): Promise<number> {
  const routes = await db
    .selectFrom('notification_route')
    .select('id')
    .where('tenant_id', '=', actor.tenantId)
    .where('active', '=', true)
    .where('deleted_at', 'is', null)
    .where((eb) => eb(eb.val<string>(p.event), '=', eb.fn.any('events')))
    .where((eb) => eb.or([eb('program_id', 'is', null), eb('program_id', '=', p.programId)]))
    .execute();
  if (routes.length === 0) return 0;
  const message: Message = {
    title: p.title,
    lines: p.lines,
    url: `${config.publicUrl.replace(/\/$/, '')}${p.path}`,
  };
  await db
    .insertInto('notification_delivery')
    .values(
      routes.map((r) => ({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        route_id: r.id,
        event: p.event,
        title: p.title,
        message: JSON.stringify(message),
      })),
    )
    .execute();
  return routes.length;
}

async function safely(log: FastifyBaseLogger | undefined, what: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    log?.error({ err: error }, `notification (${what}) not queued`);
  }
}

const kindLabel = (kind: string) => kind.replace(/_/g, ' ');

export function releasePublished(
  deps: { db: Database; config: ApiConfig },
  actor: Actor,
  releaseId: string,
  log?: FastifyBaseLogger,
) {
  return safely(log, 'release.published', async () => {
    const r = await deps.db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .innerJoin('program as p', 'p.id', 'd.program_id')
      .leftJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
      .leftJoin('experiment as e', 'e.id', 'v.experiment_id')
      .select([
        'd.program_id',
        'p.code',
        'd.name',
        'd.kind',
        'r.release_number',
        'e.name as experiment',
        'v.version_number',
      ])
      .where('r.id', '=', releaseId)
      .executeTakeFirst();
    if (!r) return;
    await enqueue(deps.db, deps.config, actor, {
      event: 'release.published',
      programId: r.program_id,
      title: `${r.code} · ${r.experiment ? `${r.experiment} v${r.version_number}: ` : ''}released ${r.name}`,
      lines: [`${kindLabel(r.kind)} dataset, release ${r.release_number}`],
      path: `/releases/${releaseId}`,
    });
  });
}

export function versionPublished(
  deps: { db: Database; config: ApiConfig },
  actor: Actor,
  versionId: string,
  log?: FastifyBaseLogger,
) {
  return safely(log, 'version.published', async () => {
    const v = await deps.db
      .selectFrom('experiment_version as v')
      .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
      .innerJoin('program as p', 'p.id', 'e.program_id')
      .leftJoin('app_user as u', 'u.id', 'v.published_by')
      .select([
        'e.id as experiment_id',
        'e.program_id',
        'e.name',
        'e.assay_type',
        'p.code',
        'v.version_number',
        'u.name as by',
      ])
      .where('v.id', '=', versionId)
      .executeTakeFirst();
    if (!v) return;
    await enqueue(deps.db, deps.config, actor, {
      event: 'version.published',
      programId: v.program_id,
      title: `${v.code} · ${v.name}: published version ${v.version_number}`,
      lines: [`${kindLabel(v.assay_type)}${v.by ? ` · by ${v.by}` : ''}`],
      path: `/experiments/${v.experiment_id}`,
    });
  });
}

export function runFinished(
  deps: { db: Database; config: ApiConfig },
  actor: Actor,
  runId: string,
  status: string,
  log?: FastifyBaseLogger,
) {
  return safely(log, 'run.finished', async () => {
    const r = await deps.db
      .selectFrom('pipeline_run as r')
      .innerJoin('experiment_version as v', 'v.id', 'r.experiment_version_id')
      .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
      .innerJoin('program as p', 'p.id', 'e.program_id')
      .leftJoin('pipeline_definition as d', 'd.id', 'r.pipeline_definition_id')
      .select(['e.program_id', 'p.code', 'e.name', 'v.version_number', 'd.name as pipeline'])
      .where('r.id', '=', runId)
      .executeTakeFirst();
    if (!r) return;
    await enqueue(deps.db, deps.config, actor, {
      event: 'run.finished',
      programId: r.program_id,
      title: `${r.code} · ${r.name} v${r.version_number}: pipeline run ${status}`,
      lines: [r.pipeline ? `Pipeline: ${r.pipeline}` : 'Pipeline run'],
      path: `/runs/${runId}`,
    });
  });
}

export function triageDecision(
  deps: { db: Database; config: ApiConfig },
  actor: Actor,
  item: { id: string; program_id: string; program_code: string; key: string; label: string | null },
  change: { from: string; to: string; reason: string | null; by: string | null },
  log?: FastifyBaseLogger,
) {
  return safely(log, 'triage.decision', () =>
    enqueue(deps.db, deps.config, actor, {
      event: 'triage.decision',
      programId: item.program_id,
      title: `${item.program_code} · ${item.label ? `${item.label} (${item.key})` : item.key}: ${change.from} → ${change.to}`,
      lines: [...(change.reason ? [`“${change.reason}”`] : []), ...(change.by ? [`by ${change.by}`] : [])],
      path: `/triage?item=${item.id}`,
    }),
  );
}
