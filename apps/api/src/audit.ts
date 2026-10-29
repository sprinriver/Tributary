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

/**
 * Writes one audit_log row for the caller. Call it inside the same transaction as the change it records, so a
 * failed change leaves no audit row and a recorded change always has one.
 */
export async function writeAudit(db: Kysely<DB>, request: FastifyRequest, entry: AuditEntry): Promise<void> {
  const principal = requirePrincipal(request);
  await db
    .insertInto('audit_log')
    .values({
      tenant_id: principal.tenantId,
      actor_id: principal.userId,
      actor_type: principal.kind === 'service' ? 'service' : 'user',
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      before: json(entry.before),
      after: json(entry.after),
      reason: entry.reason === undefined ? changeReason(request) : entry.reason,
      request_id: request.id,
      ip: request.ip || null,
    })
    .execute();
}
