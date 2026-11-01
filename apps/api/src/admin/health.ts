import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { HealthReport } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql } from 'kysely';
import type { ApiConfig } from '../config.ts';
import type { Runners } from '../pipelines/runner.ts';
import type { Storage } from '../storage.ts';

type Check = HealthReport['checks'][number];
const TIMEOUT_MS = 3000;

async function timed(
  name: string,
  label: string,
  run: () => Promise<{ status?: Check['status']; detail: string }>,
): Promise<Check> {
  const started = performance.now();
  try {
    const out = await Promise.race([
      run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`no answer within ${TIMEOUT_MS} ms`)), TIMEOUT_MS),
      ),
    ]);
    return {
      name,
      label,
      status: out.status ?? 'ok',
      detail: out.detail,
      latency_ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return { name, label, status: 'down', detail: (error as Error).message, latency_ms: null };
  }
}

async function httpOk(fetchImpl: typeof fetch, url: string): Promise<{ detail: string }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { detail: `HTTP ${res.status}` };
}

/** System health for admins (SPEC M11): every dependency is checked; one being down never fails the report. */
export async function systemHealth(deps: {
  db: Database;
  config: ApiConfig;
  storage: Storage;
  fetch: typeof fetch;
  runners: Runners;
}): Promise<HealthReport> {
  const { db, config, storage, fetch: fetchImpl } = deps;
  const checks = await Promise.all([
    timed('database', 'Database', async () => {
      await sql`select 1`.execute(db);
      return { detail: 'Postgres answers' };
    }),
    timed('object_storage', 'Object storage', async () => {
      await storage.client.send(new HeadBucketCommand({ Bucket: config.s3.rawBucket }));
      return { detail: `Bucket ${config.s3.rawBucket} reachable` };
    }),
    timed('query_service', 'Query service', () => httpOk(fetchImpl, `${config.queryUrl}/healthz`)),
    timed('compute_service', 'Compute service', () => httpOk(fetchImpl, `${config.computeUrl}/healthz`)),
    timed('identity_provider', 'Identity provider', () =>
      httpOk(fetchImpl, `${config.oidc.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`),
    ),
    timed('job_queue', 'Job queue', async () => {
      const { rows } = await sql<{ failed: string; queued: string }>`
        select count(*) filter (where state = 'failed') as failed,
               count(*) filter (where state in ('created', 'retry')) as queued
        from pgboss.job`.execute(db);
      const failed = Number(rows[0]?.failed ?? 0);
      return {
        status: failed > 0 ? 'degraded' : 'ok',
        detail: `${rows[0]?.queued ?? 0} queued, ${failed} failed`,
      };
    }),
    timed('search_index', 'Search index', async () => {
      const docs = await db
        .selectFrom('search_document')
        .select(db.fn.countAll<string>().as('n'))
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      return { detail: `${docs.n} searchable documents` };
    }),
  ]);
  const level = checks.some((c) => c.name === 'database' && c.status === 'down')
    ? 'down'
    : checks.some((c) => c.status !== 'ok')
      ? 'degraded'
      : 'ok';
  const runners = (['local', 'aws_batch', 'healthomics'] as const).map((kind) => ({
    kind,
    configured: kind in deps.runners,
    detail: kind in deps.runners ? 'Configured' : 'Not configured in this deployment',
  }));
  return {
    status: level,
    checked_at: new Date().toISOString(),
    checks,
    runners,
    // The AI assistant arrives in Phase 19; until then it is off.
    ai: { enabled: false, provider: 'none' },
  };
}
