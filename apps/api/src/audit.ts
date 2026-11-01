import type { DB } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { requirePrincipal } from './auth/plugin.ts';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** Defaults to the `X-Change-Reason` header. */
  reason?: string | null;
}

const json = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value));

/** Reason for a change, from the `X-Change-Reason` header (trimmed; empty → null). */
export function changeReason(request: FastifyRequest): string | null {
  const header = request.headers['x-change-reason'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() ? value.trim() : null;
}

/** Who made a change: a signed-in caller, or a background job running as a service account. */
export interface AuditActor {
  tenantId: string;
  userId: string;
  kind: 'user' | 'service' | 'ai_assistant_on_behalf_of';
  requestId: string;
  ip: string | null;
  /** Default reason when an entry has none. */
  reason: string | null;
}

export function requestActor(request: FastifyRequest): AuditActor {
  const principal = requirePrincipal(request);
  return {
    tenantId: principal.tenantId,
    userId: principal.userId,
    kind: principal.kind === 'service' ? 'service' : 'user',
    requestId: request.id,
    ip: request.ip || null,
    reason: changeReason(request),
  };
}

/** Writes one audit_log row. Call it inside the transaction of the change it records. */
export async function insertAudit(db: Kysely<DB>, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      tenant_id: actor.tenantId,
      actor_id: actor.userId,
      actor_type: actor.kind,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      before: json(entry.before),
      after: json(entry.after),
      reason: entry.reason === undefined ? actor.reason : entry.reason,
      request_id: actor.requestId,
      ip: actor.ip,
    })
    .execute();
}

/**
 * Writes one audit_log row for the caller. Call it inside the same transaction as the change it records, so a
 * failed change leaves no audit row and a recorded change always has one.
 */
export async function writeAudit(db: Kysely<DB>, request: FastifyRequest, entry: AuditEntry): Promise<void> {
  await insertAudit(db, requestActor(request), entry);
}
