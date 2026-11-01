import type { GroupMapping } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { GroupRoleMapping } from '../config.ts';

/** Ontologies the manifest editor can look up (OLS4 prefixes), all enabled until an admin changes it. */
export const KNOWN_ONTOLOGIES = [
  { prefix: 'NCBITaxon', label: 'NCBI Taxonomy (species)' },
  { prefix: 'cellosaurus', label: 'Cellosaurus (cell lines)' },
  { prefix: 'CL', label: 'Cell Ontology (cell types)' },
  { prefix: 'UBERON', label: 'Uberon (anatomy)' },
  { prefix: 'EFO', label: 'Experimental Factor Ontology (diseases, factors)' },
  { prefix: 'MONDO', label: 'Mondo (diseases)' },
  { prefix: 'CHEBI', label: 'ChEBI (chemical entities)' },
  { prefix: 'UO', label: 'Units of Measurement' },
  { prefix: 'MS', label: 'PSI-MS (mass spectrometry)' },
  { prefix: 'PRIDE', label: 'PRIDE controlled vocabulary' },
] as const;

export async function getSetting<T>(db: Database, tenantId: string, key: string): Promise<T | undefined> {
  const row = await db
    .selectFrom('app_setting')
    .select('value')
    .where('tenant_id', '=', tenantId)
    .where('key', '=', key)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return row?.value as T | undefined;
}

export async function putSetting(db: Database, tenantId: string, actor: string, key: string, value: unknown) {
  await db
    .insertInto('app_setting')
    .values({ tenant_id: tenantId, created_by: actor, key, value: JSON.stringify(value) })
    .onConflict((oc) =>
      oc
        .columns(['tenant_id', 'key'])
        .where('deleted_at', 'is', null)
        .doUpdateSet({ value: JSON.stringify(value) }),
    )
    .execute();
}

/**
 * Ontology prefixes an admin switched off, lower-cased (OLS4 ontology ids are lower-case). Only known sources can
 * be switched off; any other prefix a template uses stays available.
 */
export async function disabledOntologies(db: Database, tenantId: string): Promise<Set<string>> {
  const saved = await getSetting<{ enabled: string[] }>(db, tenantId, 'ontology_sources');
  if (!saved) return new Set();
  const enabled = new Set(saved.enabled.map((p) => p.toLowerCase()));
  return new Set(KNOWN_ONTOLOGIES.map((o) => o.prefix.toLowerCase()).filter((p) => !enabled.has(p)));
}

/** IdP group → role mappings stored by admins (merged with AUTH_GROUP_ROLE_MAP at sign-in). */
export async function storedGroupMappings(db: Database, tenantId: string): Promise<GroupMapping[]> {
  const rows = await db
    .selectFrom('group_role_mapping')
    .select(['group_name', 'role', 'programs'])
    .where('tenant_id', '=', tenantId)
    .where('deleted_at', 'is', null)
    .orderBy('position')
    .execute();
  return rows.map((r) => ({
    group: r.group_name,
    role: r.role as GroupMapping['role'],
    programs: r.programs,
  }));
}

export const toConfigMapping = (m: GroupMapping): GroupRoleMapping =>
  ({
    group: m.group,
    role: m.role,
    ...(m.role === 'system_admin' ? {} : { programs: m.programs }),
  }) as GroupRoleMapping;
