// Sends due notification deliveries (Phase 31, NOTIF-03). Runs on an interval in the API process and is safe with
// several replicas: rows are claimed with FOR UPDATE SKIP LOCKED. One attempt per due row per sweep; failures back
// off (30 s, 1 min, 2 min, 4 min) and the fifth failure is final.
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { assertPublicDestination } from '../webhooks/address.ts';
import { payloadFor, type Message } from './format.ts';

export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 30_000;
const BATCH = 50;
const TIMEOUT_MS = 10_000;
/** A row left in 'sending' this long (a crashed process) is taken again. */
const STALE_MS = 10 * 60_000;

export interface SweepDeps {
  db: Database;
  fetch: typeof fetch;
  config: ApiConfig;
}

/** A category for the delivery log, never raw network error text. */
function failureOf(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timed out';
  if (e instanceof Error && e.message.includes('private or reserved')) return 'blocked: private address';
  return 'connection failed';
}

/** Posts one message; returns null on success or the failure. */
export async function post(deps: SweepDeps, route: { kind: string; url: string }, message: Message) {
  try {
    if (deps.config.production) await assertPublicDestination(route.url);
    const res = await deps.fetch(route.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Tributary-Notifications/1' },
      body: JSON.stringify(payloadFor(route.kind, message)),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e) {
    return failureOf(e);
  }
}

export async function sweepNotifications(deps: SweepDeps, now: Date = new Date()): Promise<number> {
  const { db } = deps;
  const claimed = await db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('notification_delivery')
      .select(['id', 'route_id', 'message', 'attempts'])
      .where((eb) =>
        eb.or([
          eb.and([eb('status', '=', 'pending'), eb('next_attempt_at', '<=', now)]),
          eb.and([eb('status', '=', 'sending'), eb('updated_at', '<', new Date(now.getTime() - STALE_MS))]),
        ]),
      )
      .orderBy('id')
      .limit(BATCH)
      .forUpdate()
      .skipLocked()
      .execute();
    if (rows.length)
      await trx
        .updateTable('notification_delivery')
        .set({ status: 'sending' })
        .where(
          'id',
          'in',
          rows.map((r) => r.id),
        )
        .execute();
    return rows;
  });
  if (claimed.length === 0) return 0;
  const routes = new Map(
    (
      await db
        .selectFrom('notification_route')
        .select(['id', 'kind', 'url', 'active', 'deleted_at'])
        .where('id', 'in', [...new Set(claimed.map((c) => c.route_id))])
        .execute()
    ).map((r) => [r.id, r]),
  );
  for (const row of claimed) {
    const route = routes.get(row.route_id);
    const attempts = row.attempts + 1;
    if (!route || !route.active || route.deleted_at) {
      await db
        .updateTable('notification_delivery')
        .set({ status: 'failed', attempts, error: 'route paused or removed' })
        .where('id', '=', row.id)
        .execute();
      continue;
    }
    const error = await post(deps, route, row.message as unknown as Message);
    const done = error === null;
    await db
      .updateTable('notification_delivery')
      .set({
        status: done ? 'delivered' : attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        attempts,
        error,
        delivered_at: done ? new Date() : null,
        // Backoff from the wall clock (`now` only decides which rows are due).
        next_attempt_at: new Date(Date.now() + BACKOFF_MS * 2 ** (attempts - 1)),
      })
      .where('id', '=', row.id)
      .execute();
  }
  return claimed.length;
}

/** Starts the periodic sweep (production process). Returns a stop function. */
export function startNotificationSweeper(deps: SweepDeps, everyMs = 15_000, log?: (e: unknown) => void) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sweepNotifications(deps)
      .catch((e: unknown) => log?.(e))
      .finally(() => (running = false));
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
