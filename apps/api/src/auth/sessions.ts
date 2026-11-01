import type { Database } from '@tributary/db';
import { randomToken, sha256 } from './crypto.ts';

export const SESSION_COOKIE = 'trb_session';

export interface CreatedSession {
  id: string;
  /** Goes into the httpOnly cookie; only its sha256 is stored. */
  cookieValue: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  db: Database,
  userId: string,
  options: { idToken: string | null; ttlHours: number; authTime?: Date },
): Promise<CreatedSession> {
  const cookieValue = randomToken();
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + options.ttlHours * 3_600_000);
  const row = await db
    .insertInto('app_session')
    .values({
      token_hash: sha256(cookieValue),
      user_id: userId,
      csrf_token: csrfToken,
      id_token: options.idToken,
      auth_time: options.authTime ?? new Date(),
      expires_at: expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, cookieValue, csrfToken, expiresAt };
}

export interface ActiveSession {
  id: string;
  userId: string;
  csrfToken: string;
  idToken: string | null;
  authTime: Date;
}

/** The live session for a cookie value, or undefined when unknown, expired or revoked. */
export async function findSession(db: Database, cookieValue: string): Promise<ActiveSession | undefined> {
  const row = await db
    .updateTable('app_session')
    .set({ last_seen_at: new Date() })
    .where('token_hash', '=', sha256(cookieValue))
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', new Date())
    .returning(['id', 'user_id', 'csrf_token', 'id_token', 'auth_time'])
    .executeTakeFirst();
  return row
    ? {
        id: row.id,
        userId: row.user_id,
        csrfToken: row.csrf_token,
        idToken: row.id_token,
        authTime: row.auth_time,
      }
    : undefined;
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.updateTable('app_session').set({ revoked_at: new Date() }).where('id', '=', sessionId).execute();
}
