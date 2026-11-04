// SCIM 2.0 protocol helpers (Phase 35, RFC 7643/7644): errors, filters, list responses and authentication.
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import { loadPrincipal, type Principal } from '../auth/principal.ts';
import { findToken } from '../auth/tokens.ts';
import type { ApiConfig } from '../config.ts';

export const SCHEMA = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  list: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patch: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
} as const;

/** A SCIM error: `{schemas, status (string), scimType?, detail}` (RFC 7644 §3.12). */
export class ScimError extends Error {
  readonly status: number;
  readonly scimType: string | undefined;
  constructor(status: number, detail: string, scimType?: string) {
    super(detail);
    this.status = status;
    this.scimType = scimType;
  }
  body() {
    return {
      schemas: [SCHEMA.error],
      status: String(this.status),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.message,
    };
  }
}

/** `attr eq "value"` (the filters identity providers send when looking a resource up); others are refused. */
export function parseFilter(
  filter: string | undefined,
  allowed: string[],
): { attr: string; value: string } | null {
  if (!filter) return null;
  const m = /^\s*([A-Za-z.]+)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m || !allowed.includes(m[1]!))
    throw new ScimError(
      400,
      `Only "<attribute> eq \\"value\\"" filters on ${allowed.join(', ')} are supported.`,
      'invalidFilter',
    );
  return { attr: m[1]!, value: m[2]!.replace(/\\(.)/g, '$1') };
}

/** startIndex is 1-based; count defaults to 100 and is capped at 200. */
export function paging(query: Record<string, unknown>) {
  const startIndex = Math.max(1, Number.parseInt(String(query.startIndex ?? '1'), 10) || 1);
  const count = Math.min(200, Math.max(0, Number.parseInt(String(query.count ?? '100'), 10) || 0));
  return { startIndex, count, offset: startIndex - 1 };
}

export const listResponse = (resources: unknown[], total: number, startIndex: number) => ({
  schemas: [SCHEMA.list],
  totalResults: total,
  startIndex,
  itemsPerPage: resources.length,
  Resources: resources,
});

/** Entra ID sends booleans as strings ("True"/"False"). */
export const bool = (v: unknown): boolean | undefined =>
  typeof v === 'boolean' ? v : typeof v === 'string' ? v.toLowerCase() === 'true' : undefined;

/** A system admin's token with the scim scope; anything else is refused in SCIM's error format. */
export async function scimPrincipal(
  db: Database,
  config: ApiConfig,
  request: FastifyRequest,
): Promise<Principal> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? await findToken(db, header.slice(7).trim()) : undefined;
  const principal = token
    ? await loadPrincipal(db, config, token.userId, {
        type: 'token',
        tokenId: token.id,
        scopes: token.scopes,
      })
    : undefined;
  if (!token || !principal) throw new ScimError(401, 'A valid bearer token is required.');
  if (!token.scopes.includes('scim')) throw new ScimError(403, 'This token does not have the scim scope.');
  if (!principal.bindings.some((b) => b.role === 'system_admin'))
    throw new ScimError(403, 'SCIM tokens must belong to a system admin.');
  return principal;
}
