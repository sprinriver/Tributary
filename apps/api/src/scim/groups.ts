// SCIM Groups (Phase 35, SCIM-02) over app_group and group_member (source 'scim'). Roles follow from the group
// role mappings (environment and Admin → Access), exactly as for groups from the sign-in claim.
import type { Database } from '@tributary/db';
import { ScimError, SCHEMA } from './protocol.ts';

type Json = Record<string, unknown>;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);

export type GroupRow = {
  id: string;
  name: string;
  scim_external_id: string | null;
  created_at: Date;
  updated_at: Date;
};
export const groupColumns = ['id', 'name', 'scim_external_id', 'created_at', 'updated_at'] as const;

export async function members(db: Database, groupId: string) {
  return db
    .selectFrom('group_member as m')
    .innerJoin('app_user as u', 'u.id', 'm.user_id')
    .select(['u.id', 'u.name'])
    .where('m.group_id', '=', groupId)
    .where('m.deleted_at', 'is', null)
    .where('u.deleted_at', 'is', null)
    .orderBy('u.id')
    .execute();
}

export async function toScimGroup(db: Database, g: GroupRow, base: string) {
  return {
    schemas: [SCHEMA.group],
    id: g.id,
    displayName: g.name,
    ...(g.scim_external_id ? { externalId: g.scim_external_id } : {}),
    members: (await members(db, g.id)).map((m) => ({
      value: m.id,
      display: m.name,
      $ref: `${base}/scim/v2/Users/${m.id}`,
    })),
    meta: {
      resourceType: 'Group',
      created: iso(g.created_at),
      lastModified: iso(g.updated_at),
      location: `${base}/scim/v2/Groups/${g.id}`,
    },
  };
}

const memberIds = (value: unknown): string[] =>
  (Array.isArray(value) ? (value as Json[]) : value ? [value as Json] : [])
    .map((m) => (typeof m.value === 'string' ? m.value : ''))
    .filter(Boolean);

/** Users of this tenant that exist (unknown ids are an error, not silently skipped). */
async function checkUsers(db: Database, tenantId: string, ids: string[]) {
  if (ids.length === 0) return;
  const valid = /^[0-9a-f-]{36}$/i;
  const bad = ids.filter((id) => !valid.test(id));
  const found = bad.length
    ? []
    : await db
        .selectFrom('app_user')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('deleted_at', 'is', null)
        .where('id', 'in', ids)
        .execute();
  const missing = bad.length ? bad : ids.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw new ScimError(400, `Unknown member: ${missing.join(', ')}`, 'invalidValue');
}

export async function addMembers(
  db: Database,
  tenantId: string,
  actorId: string,
  groupId: string,
  ids: string[],
) {
  await checkUsers(db, tenantId, ids);
  if (ids.length === 0) return;
  await db
    .insertInto('group_member')
    .values(
      ids.map((user_id) => ({
        tenant_id: tenantId,
        created_by: actorId,
        group_id: groupId,
        user_id,
        source: 'scim',
      })),
    )
    .onConflict((oc) => oc.columns(['group_id', 'user_id']).where('deleted_at', 'is', null).doNothing())
    .execute();
}

export async function removeMembers(db: Database, groupId: string, ids: string[] | 'all') {
  let q = db
    .updateTable('group_member')
    .set({ deleted_at: new Date() })
    .where('group_id', '=', groupId)
    .where('deleted_at', 'is', null);
  if (ids !== 'all') {
    if (ids.length === 0) return;
    q = q.where('user_id', 'in', ids);
  }
  await q.execute();
}

export async function nameTaken(db: Database, tenantId: string, name: string, except?: string) {
  let q = db
    .selectFrom('app_group')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('name', '=', name)
    .where('deleted_at', 'is', null);
  if (except) q = q.where('id', '!=', except);
  return (await q.executeTakeFirst()) !== undefined;
}

export async function createGroup(db: Database, tenantId: string, actorId: string, body: Json) {
  const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!name) throw new ScimError(400, 'displayName is required.', 'invalidValue');
  if (await nameTaken(db, tenantId, name))
    throw new ScimError(409, `A group "${name}" exists.`, 'uniqueness');
  const row = await db
    .insertInto('app_group')
    .values({
      tenant_id: tenantId,
      created_by: actorId,
      name,
      scim_external_id: typeof body.externalId === 'string' ? body.externalId : null,
    })
    .returning([...groupColumns])
    .executeTakeFirstOrThrow();
  await addMembers(db, tenantId, actorId, row.id, memberIds(body.members));
  return row;
}

/** PUT: name, externalId and the full member list. */
export async function replaceGroup(db: Database, tenantId: string, actorId: string, g: GroupRow, body: Json) {
  const name =
    typeof body.displayName === 'string' && body.displayName.trim() ? body.displayName.trim() : g.name;
  if (name !== g.name && (await nameTaken(db, tenantId, name, g.id)))
    throw new ScimError(409, `A group "${name}" exists.`, 'uniqueness');
  const ids = memberIds(body.members);
  await checkUsers(db, tenantId, ids);
  const current = (await members(db, g.id)).map((m) => m.id);
  await removeMembers(
    db,
    g.id,
    current.filter((id) => !ids.includes(id)),
  );
  await addMembers(
    db,
    tenantId,
    actorId,
    g.id,
    ids.filter((id) => !current.includes(id)),
  );
  await db
    .updateTable('app_group')
    .set({
      name,
      scim_external_id: typeof body.externalId === 'string' ? body.externalId : g.scim_external_id,
    })
    .where('id', '=', g.id)
    .execute();
}

/** PATCH: add/remove/replace members (including `members[value eq "id"]`), replace displayName. */
export async function patchGroup(
  db: Database,
  tenantId: string,
  actorId: string,
  g: GroupRow,
  operations: unknown,
) {
  if (!Array.isArray(operations)) throw new ScimError(400, 'Operations is required.', 'invalidSyntax');
  for (const raw of operations as Json[]) {
    const op = String(raw.op ?? '').toLowerCase();
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    const filtered = /^members\[\s*value\s+eq\s+"([^"]+)"\s*\]$/i.exec(path);
    if (op === 'add' && (path === 'members' || path === ''))
      await addMembers(
        db,
        tenantId,
        actorId,
        g.id,
        memberIds(path ? raw.value : (raw.value as Json)?.members),
      );
    else if (op === 'remove' && filtered) await removeMembers(db, g.id, [filtered[1]!]);
    else if (op === 'remove' && path === 'members')
      await removeMembers(db, g.id, raw.value === undefined ? 'all' : memberIds(raw.value));
    else if (op === 'replace' && path === 'members') {
      await removeMembers(db, g.id, 'all');
      await addMembers(db, tenantId, actorId, g.id, memberIds(raw.value));
    } else if (op === 'replace' && (path === 'displayName' || path === '')) {
      const name = path ? raw.value : (raw.value as Json)?.displayName;
      if (typeof name === 'string' && name.trim()) {
        if (await nameTaken(db, tenantId, name.trim(), g.id))
          throw new ScimError(409, `A group "${name}" exists.`, 'uniqueness');
        await db.updateTable('app_group').set({ name: name.trim() }).where('id', '=', g.id).execute();
      }
    } else throw new ScimError(400, `Operation "${op} ${path}" is not supported on groups.`, 'invalidPath');
  }
}
