import type { Database } from '@tributary/db';
import { storedGroupMappings, toConfigMapping } from '../admin/settings.ts';
import type { ApiConfig } from '../config.ts';
import { defineAbility, type AppAbility, type Role, type RoleBinding } from './abilities.ts';
import type { TokenScope } from './tokens.ts';

export interface Principal {
  userId: string;
  tenantId: string;
  kind: 'human' | 'service';
  name: string;
  email: string;
  bindings: RoleBinding[];
  ability: AppAbility;
  via:
    | { type: 'session'; sessionId: string; csrfToken: string; idToken: string | null; authTime: Date }
    | { type: 'token'; tokenId: string; scopes: TokenScope[] };
}

/**
 * Role bindings for a user: rows bound to the user or their groups, plus bindings derived from the IdP
 * group → role mappings (environment and admin-stored). Deleted programs and bindings are ignored.
 */
export async function loadBindings(db: Database, config: ApiConfig, userId: string): Promise<RoleBinding[]> {
  const groups = await db
    .selectFrom('group_member as gm')
    .innerJoin('app_group as g', 'g.id', 'gm.group_id')
    .select(['g.id', 'g.name'])
    .where('gm.user_id', '=', userId)
    .where('gm.deleted_at', 'is', null)
    .where('g.deleted_at', 'is', null)
    .execute();
  const groupIds = groups.map((g) => g.id);

  const rows = await db
    .selectFrom('role_binding as rb')
    .leftJoin('program as p', 'p.id', 'rb.program_id')
    .select(['rb.role', 'rb.program_id', 'p.code as program_code', 'p.deleted_at as program_deleted_at'])
    .where('rb.deleted_at', 'is', null)
    .where((eb) =>
      groupIds.length
        ? eb.or([eb('rb.user_id', '=', userId), eb('rb.group_id', 'in', groupIds)])
        : eb('rb.user_id', '=', userId),
    )
    .execute();
  const bindings: RoleBinding[] = rows
    .filter((r) => !r.program_deleted_at)
    .map((r) => ({
      role: r.role as Role,
      program_id: r.program_id,
      program_code: r.program_code ?? undefined,
    }));

  const groupNames = new Set(groups.map((g) => g.name));
  // Mappings from the environment and those stored by admins (SPEC M11) apply alike.
  const stored = groupNames.size ? (await storedGroupMappings(db, config.tenantId)).map(toConfigMapping) : [];
  const mapped = [...config.groupRoleMap, ...stored].filter((m) => groupNames.has(m.group));
  if (mapped.length) {
    const programs = await db
      .selectFrom('program')
      .select(['id', 'code'])
      .where('deleted_at', 'is', null)
      .execute();
    for (const mapping of mapped) {
      if (mapping.role === 'system_admin') {
        bindings.push({ role: 'system_admin', program_id: null });
        continue;
      }
      const wanted = mapping.programs ?? [];
      for (const program of programs) {
        if (wanted.includes('*') || wanted.includes(program.code)) {
          bindings.push({ role: mapping.role, program_id: program.id, program_code: program.code });
        }
      }
    }
  }
  return bindings;
}

export async function loadPrincipal(
  db: Database,
  config: ApiConfig,
  userId: string,
  via: Principal['via'],
): Promise<Principal | undefined> {
  const user = await db
    .selectFrom('app_user')
    .select(['id', 'tenant_id', 'kind', 'name', 'email'])
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!user) return undefined;
  const bindings = await loadBindings(db, config, userId);
  return {
    userId: user.id,
    tenantId: user.tenant_id,
    kind: user.kind as Principal['kind'],
    name: user.name,
    email: user.email,
    bindings,
    ability: defineAbility(bindings),
    via,
  };
}
