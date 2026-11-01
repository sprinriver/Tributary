import { LifecyclePoliciesBodySchema, LifecyclePoliciesSchema, lifecycleRules } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance } from 'fastify';
import { insertAudit, requestActor } from '../audit.ts';
import { requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import { parse } from '../errors.ts';
import { lifecyclePolicies } from '../ingest/lifecycle.ts';
import { respond } from '../respond.ts';

const view = async (db: Database, tenantId: string) => {
  const items = await lifecyclePolicies(db, tenantId);
  return respond(LifecyclePoliciesSchema, { items, s3_rules: lifecycleRules(items) });
};

export function registerLifecycleRoutes(app: FastifyInstance, db: Database): void {
  app.get('/v1/admin/lifecycle-policies', async (request) => {
    requireSystemAdmin(request);
    return view(db, requirePrincipal(request).tenantId);
  });

  // Replaces the policies of the roles given; other roles keep theirs. New uploads are tagged by the new policy;
  // the bucket rules (s3_rules) are applied by infra/terraform.
  app.put('/v1/admin/lifecycle-policies', async (request) => {
    requireSystemAdmin(request);
    const body = parse(LifecyclePoliciesBodySchema, request.body);
    const actor = requestActor(request);
    const before = await lifecyclePolicies(db, actor.tenantId);
    await db.transaction().execute(async (trx) => {
      const roles = body.items.map((p) => p.role);
      await trx
        .updateTable('lifecycle_policy')
        .set({ deleted_at: new Date() })
        .where('tenant_id', '=', actor.tenantId)
        .where('role', 'in', roles)
        .where('deleted_at', 'is', null)
        .execute();
      await trx
        .insertInto('lifecycle_policy')
        .values(body.items.map((p) => ({ ...p, tenant_id: actor.tenantId, created_by: actor.userId })))
        .execute();
      await insertAudit(trx, actor, {
        action: 'lifecycle_policy.update',
        entityType: 'lifecycle_policy',
        entityId: actor.tenantId,
        before,
        after: body.items,
      });
    });
    return view(db, actor.tenantId);
  });
}
