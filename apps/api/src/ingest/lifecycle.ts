import { LIFECYCLE_TAG_KEY, ROLE_TAG_KEY, type LifecyclePolicy } from '@tributary/contracts';
import type { Database } from '@tributary/db';

/**
 * Defaults until an admin saves policies (SPEC M3: raw → infrequent access after N days; work dirs expire after N
 * days; ARCHITECTURE §5: exports expire after 7 days).
 */
export const DEFAULT_LIFECYCLE_POLICIES: LifecyclePolicy[] = [
  { role: 'raw', tag: 'raw', transition_days: 30, storage_class: 'STANDARD_IA', expiration_days: null },
  { role: 'processed', tag: 'processed', transition_days: null, storage_class: null, expiration_days: null },
  { role: 'metadata', tag: 'metadata', transition_days: null, storage_class: null, expiration_days: null },
  { role: 'other', tag: 'other', transition_days: null, storage_class: null, expiration_days: null },
  { role: 'work', tag: 'work', transition_days: null, storage_class: null, expiration_days: 30 },
  { role: 'export', tag: 'export', transition_days: null, storage_class: null, expiration_days: 7 },
];

/** Stored policies for the tenant, with defaults for roles that have none. */
export async function lifecyclePolicies(db: Database, tenantId: string): Promise<LifecyclePolicy[]> {
  const rows = await db
    .selectFrom('lifecycle_policy')
    .select(['role', 'tag', 'transition_days', 'storage_class', 'expiration_days'])
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .execute();
  const stored = new Map(rows.map((r) => [r.role, r as LifecyclePolicy]));
  return DEFAULT_LIFECYCLE_POLICIES.map((d) => stored.get(d.role) ?? d);
}

/** Object tags for a file of `role` under the current policies. */
export async function lifecycleTags(
  db: Database,
  tenantId: string,
  role: string,
): Promise<{ tag: string; tags: Record<string, string> }> {
  const policy = (await lifecyclePolicies(db, tenantId)).find((p) => p.role === role);
  const tag = policy?.tag ?? role;
  return { tag, tags: { [ROLE_TAG_KEY]: role, [LIFECYCLE_TAG_KEY]: tag } };
}
