import type { Database } from '@tributary/db';
import type { Transaction } from 'kysely';
import type { DB } from '@tributary/db';

type NodeKind = 'file' | 'dataset_release' | 'pipeline_run' | 'experiment_version';
type Relation = 'input_to' | 'produced' | 'derived_from' | 'describes';
type Db = Database | Transaction<DB>;

/** Lineage node for an entity (created once; SPEC §4 LineageNode). */
async function node(
  db: Db,
  tenantId: string,
  actorId: string,
  kind: NodeKind,
  entityId: string,
): Promise<string> {
  await db
    .insertInto('lineage_node')
    .values({ tenant_id: tenantId, created_by: actorId, kind, entity_id: entityId })
    .onConflict((oc) => oc.columns(['kind', 'entity_id']).doNothing())
    .execute();
  const row = await db
    .selectFrom('lineage_node')
    .select('id')
    .where('kind', '=', kind)
    .where('entity_id', '=', entityId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Records `from —relation→ to` once. */
export async function linkLineage(
  db: Db,
  tenantId: string,
  actorId: string,
  from: { kind: NodeKind; id: string },
  relation: Relation,
  to: { kind: NodeKind; id: string },
): Promise<void> {
  const fromId = await node(db, tenantId, actorId, from.kind, from.id);
  const toId = await node(db, tenantId, actorId, to.kind, to.id);
  await db
    .insertInto('lineage_edge')
    .values({ tenant_id: tenantId, created_by: actorId, from_node_id: fromId, to_node_id: toId, relation })
    .onConflict((oc) => oc.columns(['from_node_id', 'to_node_id', 'relation']).doNothing())
    .execute();
}
