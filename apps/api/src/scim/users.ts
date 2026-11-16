// SCIM Users (Phase 35, SCIM-01/04) over app_user. Provisioned users get a placeholder sub ("scim:…") until their
// first sign-in links them (auth/login-user.ts). Deactivation is reversible; DELETE is a soft delete.
import type { Database } from '@tributary/db';
import { randomUUID } from 'node:crypto';
import { bool, ScimError, SCHEMA } from './protocol.ts';

type Json = Record<string, unknown>;
const iso = (v: Date | string) => (v instanceof Date ? v.toISOString() : v);

export const userColumns = [
  'id',
  'email',
  'name',
  'scim_user_name',
  'scim_external_id',
  'deactivated_at',
  'created_at',
  'updated_at',
] as const;
export type UserRow = {
  id: string;
  email: string;
  name: string;
  scim_user_name: string | null;
  scim_external_id: string | null;
  deactivated_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export function toScimUser(u: UserRow, base: string) {
  return {
    schemas: [SCHEMA.user],
    id: u.id,
    userName: u.scim_user_name ?? u.email,
    ...(u.scim_external_id ? { externalId: u.scim_external_id } : {}),
    displayName: u.name,
    name: { formatted: u.name },
    emails: u.email ? [{ value: u.email, primary: true, type: 'work' }] : [],
    active: u.deactivated_at === null,
    meta: {
      resourceType: 'User',
      created: iso(u.created_at),
      lastModified: iso(u.updated_at),
      location: `${base}/scim/v2/Users/${u.id}`,
    },
  };
}

/** The fields a SCIM User body sets (only those present). */
export function userFields(body: Json): {
  userName?: string;
  externalId?: string | null;
  name?: string;
  email?: string;
  active?: boolean;
} {
  const out: ReturnType<typeof userFields> = {};
  if (typeof body.userName === 'string' && body.userName.trim()) out.userName = body.userName.trim();
  if (typeof body.externalId === 'string') out.externalId = body.externalId;
  const name = body.name as Json | undefined;
  const display =
    typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim()
      : typeof name?.formatted === 'string' && name.formatted.trim()
        ? name.formatted.trim()
        : [name?.givenName, name?.familyName].filter((x) => typeof x === 'string' && x).join(' ');
  if (display) out.name = display;
  const emails = Array.isArray(body.emails) ? (body.emails as Json[]) : [];
  const email = emails.find((e) => e.primary === true || bool(e.primary)) ?? emails[0];
  if (typeof email?.value === 'string' && email.value.trim()) out.email = email.value.trim();
  const active = bool(body.active);
  if (active !== undefined) out.active = active;
  return out;
}

export async function userNameTaken(db: Database, tenantId: string, userName: string, except?: string) {
  let q = db
    .selectFrom('app_user')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .where((eb) => eb(eb.fn('lower', ['scim_user_name']), '=', userName.toLowerCase()));
  if (except) q = q.where('id', '!=', except);
  return (await q.executeTakeFirst()) !== undefined;
}

export async function createUser(db: Database, tenantId: string, actorId: string, body: Json) {
  const f = userFields(body);
  if (!f.userName) throw new ScimError(400, 'userName is required.', 'invalidValue');
  if (await userNameTaken(db, tenantId, f.userName))
    throw new ScimError(409, `A user with userName "${f.userName}" exists.`, 'uniqueness');
  const email = f.email ?? (f.userName.includes('@') ? f.userName : '');
  return db
    .insertInto('app_user')
    .values({
      tenant_id: tenantId,
      created_by: actorId,
      sub: `scim:${randomUUID()}`,
      email,
      name: f.name ?? f.userName,
      scim_user_name: f.userName,
      scim_external_id: f.externalId ?? null,
      deactivated_at: f.active === false ? new Date() : null,
    })
    .returning([...userColumns])
    .executeTakeFirstOrThrow();
}

/** Applies fields to a user (replace: missing optional fields are cleared where SCIM says so). */
export async function updateUser(
  db: Database,
  tenantId: string,
  user: UserRow,
  f: ReturnType<typeof userFields>,
): Promise<UserRow> {
  if (f.userName && (await userNameTaken(db, tenantId, f.userName, user.id)))
    throw new ScimError(409, `A user with userName "${f.userName}" exists.`, 'uniqueness');
  return db
    .updateTable('app_user')
    .set({
      ...(f.userName !== undefined ? { scim_user_name: f.userName } : {}),
      ...(f.externalId !== undefined ? { scim_external_id: f.externalId } : {}),
      ...(f.name !== undefined ? { name: f.name } : {}),
      ...(f.email !== undefined ? { email: f.email } : {}),
      ...(f.active !== undefined
        ? { deactivated_at: f.active ? null : (user.deactivated_at ?? new Date()) }
        : {}),
    })
    .where('id', '=', user.id)
    .returning([...userColumns])
    .executeTakeFirstOrThrow() as Promise<UserRow>;
}

/** PATCH (RFC 7644 §3.5.2) for the attributes IdPs change: active, displayName, name, emails, userName, externalId. */
export function patchToFields(operations: unknown): ReturnType<typeof userFields> {
  if (!Array.isArray(operations)) throw new ScimError(400, 'Operations is required.', 'invalidSyntax');
  const fields: ReturnType<typeof userFields> = {};
  for (const raw of operations as Json[]) {
    const op = String(raw.op ?? '').toLowerCase();
    if (op !== 'replace' && op !== 'add')
      throw new ScimError(400, `Operation "${String(raw.op)}" is not supported on users.`, 'invalidSyntax');
    const path = typeof raw.path === 'string' ? raw.path : '';
    const value = raw.value;
    const body: Json =
      path === ''
        ? ((value ?? {}) as Json)
        : path === 'name.formatted'
          ? { name: { formatted: value } }
          : path === 'name.givenName' || path === 'name.familyName'
            ? {} // a full name arrives with displayName; parts alone are ignored
            : path.startsWith('emails')
              ? { emails: Array.isArray(value) ? value : [{ value, primary: true }] }
              : { [path]: value };
    Object.assign(fields, userFields(body));
  }
  return fields;
}
