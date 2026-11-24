// Personal email preferences (Phase 34, MAIL-01): each person edits only their own; every change is audited.
import { NotificationPreferencesBodySchema, NotificationPreferencesSchema } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requirePrincipal } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { parse } from '../errors.ts';
import { emailEnabled, preferencesOf } from '../notifications/email.ts';
import { respond } from '../respond.ts';

export function registerEmailRoutes(app: FastifyInstance, deps: { db: Database; config: ApiConfig }): void {
  const { db, config } = deps;
  const view = async (userId: string) => {
    const user = await db.selectFrom('app_user').select('email').where('id', '=', userId).executeTakeFirst();
    return respond(NotificationPreferencesSchema, {
      ...(await preferencesOf(db, userId)),
      address: user?.email ?? '',
      email_available: emailEnabled(config),
    });
  };

  app.get('/v1/me/notification-preferences', async (request) => view(requirePrincipal(request).userId));

  app.put('/v1/me/notification-preferences', async (request) => {
    const body = parse(NotificationPreferencesBodySchema, request.body);
    const actor = requestActor(request);
    const before = await preferencesOf(db, actor.userId);
    await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('notification_preference')
        .values({
          tenant_id: actor.tenantId,
          created_by: actor.userId,
          user_id: actor.userId,
          email: body.email,
          events: body.events,
        })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ email: body.email, events: body.events }))
        .returning('id')
        .executeTakeFirstOrThrow();
      await insertAudit(trx, actor, {
        action: 'notification_preference.update',
        entityType: 'notification_preference',
        entityId: row.id,
        before,
        after: body,
      });
    });
    return view(actor.userId);
  });
}
