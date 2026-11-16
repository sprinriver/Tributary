// Personal email (Phase 34, MAIL-01…03): preferences and the email outbox. Messages carry names and links only.
import { PERSONAL_EVENTS, type PersonalEvent } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyBaseLogger } from 'fastify';
import type { ApiConfig } from '../config.ts';

export interface Preferences {
  email: boolean;
  events: PersonalEvent[];
}
export const DEFAULT_PREFERENCES: Preferences = { email: true, events: [...PERSONAL_EVENTS] };

export async function preferencesOf(db: Database, userId: string): Promise<Preferences> {
  const row = await db
    .selectFrom('notification_preference')
    .select(['email', 'events'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row ? { email: row.email, events: row.events as PersonalEvent[] } : DEFAULT_PREFERENCES;
}

export const emailEnabled = (config: ApiConfig) => config.email.transport !== 'none';

/**
 * Queues one email to a person if email is configured, they have an address and they want this event. Best effort:
 * a failure is logged and never fails the change that caused it.
 */
export async function emailUser(
  deps: { db: Database; config: ApiConfig },
  actor: { tenantId: string; userId: string },
  userId: string,
  event: PersonalEvent,
  message: { subject: string; lines: string[]; path: string },
  log?: FastifyBaseLogger,
): Promise<void> {
  try {
    if (!emailEnabled(deps.config)) return;
    const user = await deps.db
      .selectFrom('app_user')
      .select(['email', 'name'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user?.email) return;
    const prefs = await preferencesOf(deps.db, userId);
    if (!prefs.email || !prefs.events.includes(event)) return;
    const link = `${deps.config.publicUrl.replace(/\/$/, '')}${message.path}`;
    await deps.db
      .insertInto('email_delivery')
      .values({
        tenant_id: actor.tenantId,
        created_by: actor.userId,
        user_id: userId,
        event,
        to_address: user.email,
        subject: `Tributary: ${message.subject}`,
        body: [
          `Hello ${user.name},`,
          '',
          ...message.lines,
          '',
          `Open in Tributary: ${link}`,
          '',
          'You get this email because of your notification settings in Tributary.',
        ].join('\n'),
      })
      .execute();
  } catch (error) {
    log?.error({ err: error }, `email (${event}) not queued`);
  }
}
