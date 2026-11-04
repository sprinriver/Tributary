import type { Database } from '@tributary/db';

export interface LoginIdentity {
  sub: string;
  email: string;
  name: string;
  groups: string[];
}

/** Creates or updates the signed-in user and mirrors their IdP groups; returns the user id. Run in a transaction. */
export async function upsertLoginUser(db: Database, tenantId: string, login: LoginIdentity): Promise<string> {
  await linkProvisionedUser(db, tenantId, login);
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

/**
 * First sign-in of a user the IdP provisioned by SCIM (Phase 35): the provisioned account (not yet linked: its
 * sub is a placeholder) with the same email, case-insensitive, takes this sign-in's sub. The same IdP vouches
 * for both, and only unlinked SCIM accounts are ever matched.
 */
async function linkProvisionedUser(db: Database, tenantId: string, login: LoginIdentity): Promise<void> {
  const existing = await db
    .selectFrom('app_user')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('sub', '=', login.sub)
    .executeTakeFirst();
  if (existing) return;
  const provisioned = await db
    .selectFrom('app_user')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('sub', 'like', 'scim:%')
    .where('deleted_at', 'is', null)
    .where((eb) => eb(eb.fn('lower', ['email']), '=', login.email.toLowerCase()))
    .orderBy('id')
    .executeTakeFirst();
  if (provisioned)
    await db.updateTable('app_user').set({ sub: login.sub }).where('id', '=', provisioned.id).execute();
}

/**
 * Mirrors the IdP's groups claim into app_group / group_member (soft-deleting memberships that ended). Only
 * memberships that came from sign-in are changed: SCIM-managed ones stay (Phase 35).
 */
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
    .select(['id', 'group_id', 'source'])
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .execute();
  const ended = current
    .filter((m) => m.source === 'login' && !groupIds.includes(m.group_id))
    .map((m) => m.id);
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
