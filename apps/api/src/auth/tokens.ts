import type { Database } from '@tributary/db';
import { randomToken, sha256 } from './crypto.ts';

export type TokenScope = 'read' | 'write';
export const TOKEN_PREFIX = 'trb_';

export interface CreatedToken {
  id: string;
  /** Shown to the user once; only its sha256 is stored. */
  token: string;
  prefix: string;
  expiresAt: Date;
}

export async function createPersonalAccessToken(
  db: Database,
  userId: string,
  options: { name: string; scopes: TokenScope[]; expiresAt: Date },
): Promise<CreatedToken> {
  const token = `${TOKEN_PREFIX}${randomToken()}`;
  const prefix = token.slice(0, 12);
  const user = await db
    .selectFrom('app_user')
    .select('tenant_id')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const row = await db
    .insertInto('access_token')
    .values({
      tenant_id: user.tenant_id,
      created_by: userId,
      user_id: userId,
      name: options.name,
      token_prefix: prefix,
      token_hash: sha256(token),
      scopes: options.scopes,
      expires_at: options.expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, token, prefix, expiresAt: options.expiresAt };
}

export interface ActiveToken {
  id: string;
  userId: string;
  scopes: TokenScope[];
}

export async function findToken(db: Database, token: string): Promise<ActiveToken | undefined> {
  if (!token.startsWith(TOKEN_PREFIX)) return undefined;
  const row = await db
    .updateTable('access_token')
    .set({ last_used_at: new Date() })
    .where('token_hash', '=', sha256(token))
    .where('revoked_at', 'is', null)
    .where('deleted_at', 'is', null)
    .where('expires_at', '>', new Date())
    .returning(['id', 'user_id', 'scopes'])
    .executeTakeFirst();
  return row ? { id: row.id, userId: row.user_id, scopes: row.scopes as TokenScope[] } : undefined;
}

/** Revokes one of the user's own tokens; returns false when it does not exist or is not theirs. */
export async function revokePersonalAccessToken(
  db: Database,
  userId: string,
  tokenId: string,
): Promise<boolean> {
  const result = await db
    .updateTable('access_token')
    .set({ revoked_at: new Date() })
    .where('id', '=', tokenId)
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function listTokens(db: Database, userId: string) {
  return db
    .selectFrom('access_token')
    .select([
      'id',
      'name',
      'token_prefix',
      'scopes',
      'expires_at',
      'revoked_at',
      'last_used_at',
      'created_at',
    ])
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .orderBy('created_at', 'desc')
    .execute();
}
