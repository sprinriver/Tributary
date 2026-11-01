import type { Database } from '@tributary/db';
import { assertPublicDestination } from './address.ts';
import { signatureHeader } from './signature.ts';

export interface WebhookDeps {
  db: Database;
  fetch: typeof fetch;
  tenantId: string;
  /** Production refuses destinations that resolve to private addresses (SSRF guard). */
  production?: boolean;
}

/** What callers see about a failed attempt: a category, never raw network error text. */
function failureOf(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timed out';
  if (e instanceof Error && e.message.includes('private or reserved')) return 'blocked: private address';
  return 'connection failed';
}

interface Subscription {
  id: string;
  url: string;
  secret: string;
  created_by: string;
}

/** Attempts per delivery and the first backoff; later attempts double it. */
const ATTEMPTS = 3;
const BACKOFF_MS = 200;
const TIMEOUT_MS = 10_000;

export interface DeliveryRow {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  response_status: number | null;
  error: string | null;
  created_at: Date;
  delivered_at: Date | null;
}

/** Sends one signed event to one subscription, retrying with backoff, and records the delivery. */
export async function deliver(
  deps: WebhookDeps,
  sub: Subscription,
  event: string,
  data: Record<string, unknown>,
): Promise<DeliveryRow> {
  const row = await deps.db
    .insertInto('webhook_delivery')
    .values({
      tenant_id: deps.tenantId,
      created_by: sub.created_by,
      subscription_id: sub.id,
      event,
      payload: JSON.stringify(data),
      status: 'pending',
    })
    .returning(['id', 'created_at'])
    .executeTakeFirstOrThrow();
  const body = JSON.stringify({ id: row.id, event, created_at: row.created_at.toISOString(), data });
  let status: number | null = null;
  let error: string | null = null;
  let attempts = 0;
  for (; attempts < ATTEMPTS;) {
    attempts++;
    try {
      if (deps.production) await assertPublicDestination(sub.url);
      const res = await deps.fetch(sub.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Tributary-Webhooks/1',
          'x-tributary-event': event,
          'x-tributary-delivery': row.id,
          // Signed per attempt, so a retry is not rejected as a replay.
          'x-tributary-signature': signatureHeader(sub.secret, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      error = res.ok ? null : `HTTP ${res.status}`;
      if (res.ok) break;
    } catch (e) {
      status = null;
      error = failureOf(e);
    }
    if (attempts < ATTEMPTS) await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** (attempts - 1)));
  }
  const delivered = error === null;
  return deps.db
    .updateTable('webhook_delivery')
    .set({
      status: delivered ? 'delivered' : 'failed',
      attempts,
      response_status: status,
      error,
      delivered_at: delivered ? new Date() : null,
    })
    .where('id', '=', row.id)
    .returning([
      'id',
      'event',
      'status',
      'attempts',
      'response_status',
      'error',
      'created_at',
      'delivered_at',
    ])
    .executeTakeFirstOrThrow() as Promise<DeliveryRow>;
}

export interface RunStatusEvent {
  run_id: string;
  status: string;
  previous_status: string | null;
  pipeline_key: string | null;
  experiment_version_id: string | null;
}

/** Notifies every active `run.status` subscription of a run's new status (SPEC M13). */
export async function notifyRunStatus(deps: WebhookDeps, event: RunStatusEvent): Promise<void> {
  const subs = await deps.db
    .selectFrom('webhook_subscription')
    .select(['id', 'url', 'secret', 'created_by'])
    .where('tenant_id', '=', deps.tenantId)
    .where('active', '=', true)
    .where('deleted_at', 'is', null)
    .where((eb) => eb(eb.val('run.status'), '=', eb.fn.any('events')))
    .execute();
  await Promise.all(subs.map((sub) => deliver(deps, sub, 'run.status', { ...event })));
}
