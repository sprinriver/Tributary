// Support bundle (Phase 37, SUP-01): what support needs to diagnose an installation, in one file. Built from an
// allowlist: configuration appears only as feature switches and host names, never as values that could carry a
// secret (tokens, keys, URLs with credentials); failures carry no names or addresses.
import type { HealthReport } from '@tributary/contracts';
import { listMigrationNames, type Database } from '@tributary/db';
import { sql } from 'kysely';
import type { ApiConfig } from '../config.ts';
import { API_VERSION, APP_BUILD } from '../version.ts';

const DAY = 86_400_000;
const LATEST = 10;
const host = (url: string) => {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
};
const iso = (v: Date | string | null) => (v === null ? null : new Date(v).toISOString());

/** Configuration as switches and host names only (an allowlist: anything not named here is left out). */
export function configurationSummary(config: ApiConfig, runners: string[]) {
  return {
    production: config.production,
    public_host: host(config.publicUrl),
    oidc_issuer_host: host(config.oidc.issuer),
    group_role_mappings_from_env: config.groupRoleMap.length,
    s3_endpoint_host: config.s3.endpoint ? host(config.s3.endpoint) : 'AWS default',
    s3_static_credentials: config.s3.credentials !== undefined,
    query_host: host(config.queryUrl),
    compute_host: host(config.computeUrl),
    pipeline_runners: runners,
    ai_provider: config.ai.provider,
    email_transport: config.email.transport,
    email_configured:
      config.email.transport === 'ses' || (config.email.transport === 'smtp' && !!config.email.smtpUrl),
    notify_extra_hosts: config.notifyExtraHosts.length,
    protein_models_dir_set: !!config.proteinModels.dir,
    alphafold_host: host(config.proteinModels.alphafoldUrl),
    demo_mode: config.instance.demo,
  };
}

export async function supportBundle(
  deps: { db: Database; config: ApiConfig; runners: string[] },
  health: HealthReport,
  tenantId: string,
  now = new Date(),
) {
  const { db } = deps;
  const since = new Date(now.getTime() - 7 * DAY);
  const applied = (
    await sql<{ name: string }>`select name from kysely_migration order by name`
      .execute(db)
      .catch(() => ({ rows: [] }))
  ).rows.map((r) => r.name);
  const postgres = (await sql<{ v: string }>`show server_version`.execute(db)).rows[0]?.v ?? null;
  const count = async (q: Promise<{ n: string | number | bigint } | undefined>) => Number((await q)?.n ?? 0);
  const n = (table: 'app_user' | 'program' | 'experiment' | 'notification_route') =>
    count(
      db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst(),
    );

  const failedRuns = await db
    .selectFrom('pipeline_run as r')
    .leftJoin('pipeline_definition as d', 'd.id', 'r.pipeline_definition_id')
    .select(['r.id', 'r.status', 'r.updated_at', 'd.key as pipeline'])
    .where('r.tenant_id', '=', tenantId)
    .where('r.status', 'in', ['failed', 'cancelled'])
    .where('r.updated_at', '>=', since)
    .orderBy('r.updated_at', 'desc')
    .limit(LATEST)
    .execute();
  const failedDeliveries = await db
    .selectFrom('notification_delivery as d')
    .innerJoin('notification_route as r', 'r.id', 'd.route_id')
    .select(['d.event', 'd.error', 'd.attempts', 'd.updated_at', 'r.kind'])
    .where('d.tenant_id', '=', tenantId)
    .where('d.status', '=', 'failed')
    .where('d.updated_at', '>=', since)
    .orderBy('d.updated_at', 'desc')
    .execute();
  const failedEmails = await db
    .selectFrom('email_delivery')
    .select(['event', 'error', 'attempts', 'updated_at']) // never the address or the body
    .where('tenant_id', '=', tenantId)
    .where('status', '=', 'failed')
    .where('updated_at', '>=', since)
    .orderBy('updated_at', 'desc')
    .execute();
  const rejected = await count(
    db
      .selectFrom('audit_log')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('tenant_id', '=', tenantId)
      .where('action', '=', 'release.reject')
      .where('at', '>=', since)
      .executeTakeFirst(),
  );

  return {
    generated_at: now.toISOString(),
    instance: {
      name: deps.config.instance.name,
      version: API_VERSION,
      build: APP_BUILD,
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
    },
    database: {
      postgres,
      migrations_applied: applied,
      migrations_pending: listMigrationNames().filter((m) => !applied.includes(m)),
    },
    health,
    configuration: configurationSummary(deps.config, deps.runners),
    counts: {
      users: await n('app_user'),
      programs: await n('program'),
      experiments: await n('experiment'),
      notification_routes: await n('notification_route'),
    },
    recent_failures: {
      window_days: 7,
      pipeline_runs: {
        count: failedRuns.length,
        latest: failedRuns.map((r) => ({
          id: r.id,
          status: r.status,
          pipeline: r.pipeline,
          at: iso(r.updated_at),
        })),
      },
      notification_deliveries: {
        count: failedDeliveries.length,
        latest: failedDeliveries.slice(0, LATEST).map((d) => ({
          kind: d.kind,
          event: d.event,
          error: d.error,
          attempts: d.attempts,
          at: iso(d.updated_at),
        })),
      },
      emails: {
        count: failedEmails.length,
        latest: failedEmails
          .slice(0, LATEST)
          .map((e) => ({ event: e.event, error: e.error, attempts: e.attempts, at: iso(e.updated_at) })),
      },
      imports_rejected: rejected,
    },
  };
}
