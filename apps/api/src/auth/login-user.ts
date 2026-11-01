import type { Database } from '@tributary/db';

export interface LoginIdentity {
  sub: string;
  email: string;
  name: string;
  groups: string[];
}

/** Creates or updates the signed-in user and mirrors their IdP groups; returns the user id. Run in a transaction. */
export async function upsertLoginUser(db: Database, tenantId: string, login: LoginIdentity): Promise<string> {
  // Upsert: two callbacks for the same user can run at once (two tabs, parallel sign-ins).
  const { id } = await db
    .insertInto('app_user')
    .values({
      tenant_id: tenantId,
      created_by: tenantId,
      sub: login.sub,
      email: login.email,
      name: login.name,
      last_login_at: new Date(),
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'sub']).doUpdateSet({
        email: login.email,
        name: login.name,
        last_login_at: new Date(),
      }),
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  await syncGroups(db, tenantId, id, login.groups);
  return id;
}

/** Mirrors the IdP's groups claim into app_group / group_member (soft-deleting memberships that ended). */
async function syncGroups(db: Database, tenantId: string, userId: string, groups: string[]): Promise<void> {
  const groupIds: string[] = [];
  for (const name of [...new Set(groups)]) {
    // Insert-if-missing, then read: safe when another sign-in creates the same group at the same time.
    await db
      .insertInto('app_group')
      .values({ tenant_id: tenantId, created_by: userId, name })
      .onConflict((oc) => oc.columns(['tenant_id', 'name']).where('deleted_at', 'is', null).doNothing())
      .execute();
    const group = await db
      .selectFrom('app_group')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('name', '=', name)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    groupIds.push(group.id);
  }
  const current = await db
    .selectFrom('group_member')
    .select(['id', 'group_id'])
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .execute();
  const ended = current.filter((m) => !groupIds.includes(m.group_id)).map((m) => m.id);
  if (ended.length)
    await db.updateTable('group_member').set({ deleted_at: new Date() }).where('id', 'in', ended).execute();
  const missing = groupIds.filter((id) => !current.some((m) => m.group_id === id));
  if (missing.length) {
    await db
      .insertInto('group_member')
      .values(
        missing.map((group_id) => ({ tenant_id: tenantId, created_by: userId, group_id, user_id: userId })),
      )
      .onConflict((oc) => oc.columns(['group_id', 'user_id']).where('deleted_at', 'is', null).doNothing())
      .execute();
  }
}
