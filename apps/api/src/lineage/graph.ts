import type { LineageGraph, LineageKind, LineageGraphNode } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql } from 'kysely';

const NODE_CAP = 200;
type Edge = LineageGraph['edges'][number];
type Found = { kind: LineageKind; id: string; depth: number };
type Detail = Omit<LineageGraphNode, 'depth'> & {
  program_id: string | null;
  owner?: string;
  private?: boolean;
};

const key = (kind: string, id: string) => `${kind}:${id}`;

/**
 * Walks `lineage.link` (recursive CTE, one per direction) up to `depth` steps; a node's path guards against cycles.
 * Upstream nodes get negative depths.
 */
async function walk(
  db: Database,
  root: { kind: LineageKind; id: string },
  depth: number,
  direction: 'upstream' | 'downstream' | 'both',
): Promise<Found[]> {
  const run = async (up: boolean) => {
    const [near, far, nearId, farId] = up
      ? ['to_kind', 'from_kind', 'to_id', 'from_id']
      : ['from_kind', 'to_kind', 'from_id', 'to_id'];
    const rows = await sql<{ kind: LineageKind; id: string; steps: number }>`
      with recursive walk(kind, id, steps, path) as (
        select ${root.kind}::text, ${root.id}::uuid, 0, array[${key(root.kind, root.id)}]
        union all
        select l.${sql.raw(far)}, l.${sql.raw(farId)}, w.steps + 1,
               w.path || (l.${sql.raw(far)} || ':' || l.${sql.raw(farId)})
        from walk w
        join lineage.link l on l.${sql.raw(near)} = w.kind and l.${sql.raw(nearId)} = w.id
        where w.steps < ${depth} and not ((l.${sql.raw(far)} || ':' || l.${sql.raw(farId)}) = any(w.path))
      )
      select kind, id, min(steps) as steps from walk where steps > 0 group by kind, id
      order by steps, kind, id
      limit ${NODE_CAP + 1}`.execute(db);
    return rows.rows.map((r) => ({ kind: r.kind, id: r.id, depth: up ? -r.steps : r.steps }));
  };
  const found: Found[] = [{ ...root, depth: 0 }];
  if (direction !== 'downstream') found.push(...(await run(true)));
  if (direction !== 'upstream') found.push(...(await run(false)));
  const seen = new Set<string>();
  return found.filter((f) => {
    const k = key(f.kind, f.id);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Labels, programs and visibility of the found nodes (one query per kind). */
async function details(db: Database, found: Found[]): Promise<Map<string, Detail>> {
  const ids = (kind: LineageKind) => [...new Set(found.filter((f) => f.kind === kind).map((f) => f.id))];
  const out = new Map<string, Detail>();
  const put = (d: Detail) => out.set(key(d.kind, d.id), d);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const list = (kind: LineageKind) => (ids(kind).length ? ids(kind) : none);

  for (const r of await db
    .selectFrom('file_object as f')
    .leftJoin('experiment_version as v', 'v.id', 'f.experiment_version_id')
    .leftJoin('experiment as e', 'e.id', 'v.experiment_id')
    .leftJoin('program as p', 'p.id', 'e.program_id')
    .select(['f.id', 'f.name', 'f.role', 'f.ingest_status', 'e.program_id', 'p.code'])
    .where('f.id', 'in', list('file'))
    .where('f.deleted_at', 'is', null)
    .execute())
    put({
      kind: 'file',
      id: r.id,
      label: r.name,
      detail: `${r.role} file`,
      status: r.ingest_status,
      program_id: r.program_id,
      program_code: r.code,
    });

  for (const r of await db
    .selectFrom('dataset_release as r')
    .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
    .innerJoin('program as p', 'p.id', 'd.program_id')
    .select(['r.id', 'r.release_number', 'r.status', 'd.name', 'd.kind', 'd.program_id', 'p.code'])
    .where('r.id', 'in', list('dataset_release'))
    .where('r.deleted_at', 'is', null)
    .execute())
    put({
      kind: 'dataset_release',
      id: r.id,
      label: `${r.name} · release ${r.release_number}`,
      detail: r.kind,
      status: r.status,
      program_id: r.program_id,
      program_code: r.code,
    });

  for (const r of await db
    .selectFrom('pipeline_run as run')
    .innerJoin('pipeline_definition as pd', 'pd.id', 'run.pipeline_definition_id')
    .innerJoin('experiment_version as v', 'v.id', 'run.experiment_version_id')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select([
      'run.id',
      'run.status',
      'run.runner',
      'pd.name',
      'pd.repo',
      'pd.revision',
      'e.program_id',
      'p.code',
    ])
    .where('run.id', 'in', list('pipeline_run'))
    .execute())
    put({
      kind: 'pipeline_run',
      id: r.id,
      label: `${r.name} run`,
      // The pipeline revision is part of the run's provenance (SPEC M10 check).
      detail: `${r.repo} @ ${r.revision} · ${r.runner} runner`,
      status: r.status,
      program_id: r.program_id,
      program_code: r.code,
    });

  for (const r of await db
    .selectFrom('experiment_version as v')
    .innerJoin('experiment as e', 'e.id', 'v.experiment_id')
    .innerJoin('program as p', 'p.id', 'e.program_id')
    .select(['v.id', 'v.version_number', 'v.status', 'e.name', 'e.assay_type', 'e.program_id', 'p.code'])
    .where('v.id', 'in', list('experiment_version'))
    .where('v.deleted_at', 'is', null)
    .execute())
    put({
      kind: 'experiment_version',
      id: r.id,
      label: `${r.name} v${r.version_number}`,
      detail: String(r.assay_type),
      status: r.status,
      program_id: r.program_id,
      program_code: r.code,
    });

  for (const r of await db
    .selectFrom('saved_view as v')
    .leftJoin('program as p', 'p.id', 'v.program_id')
    .select(['v.id', 'v.name', 'v.owner', 'v.visibility', 'v.program_id', 'v.chart_spec', 'p.code'])
    .where('v.id', 'in', list('chart'))
    .where('v.deleted_at', 'is', null)
    .execute())
    put({
      kind: 'chart',
      id: r.id,
      label: r.name,
      detail: `${String((r.chart_spec as { type?: string } | null)?.type ?? 'chart')} chart`,
      status: null,
      program_id: r.program_id,
      program_code: r.code,
      owner: r.owner,
      private: r.visibility !== 'program',
    });
  return out;
}

/**
 * The lineage graph around one entity, limited to what the caller may read: program data of their programs
 * (`programs` null = all, for system admins), their own saved charts and program charts of their programs.
 * Returns undefined when the root itself is not readable (the route answers 404).
 */
export async function lineageGraph(
  db: Database,
  caller: { userId: string; programs: string[] | null },
  root: { kind: LineageKind; id: string },
  depth: number,
  direction: 'upstream' | 'downstream' | 'both',
): Promise<LineageGraph | undefined> {
  const found = await walk(db, root, depth, direction);
  const info = await details(db, found);
  const readable = (d: Detail | undefined) => {
    if (!d) return false;
    if (d.kind === 'chart' && d.private) return d.owner === caller.userId;
    if (caller.programs === null) return true;
    return d.program_id !== null && caller.programs.includes(d.program_id);
  };
  if (!readable(info.get(key(root.kind, root.id)))) return undefined;
  const visible = found.filter((f) => readable(info.get(key(f.kind, f.id))));
  const truncated = visible.length > NODE_CAP || found.length > NODE_CAP * 2;
  const nodes: LineageGraphNode[] = visible.slice(0, NODE_CAP).map((f) => {
    const { program_id: _p, owner: _o, private: _v, ...d } = info.get(key(f.kind, f.id))!;
    return { ...d, depth: f.depth };
  });
  const shown = new Set(nodes.map((n) => key(n.kind, n.id)));
  const ids = nodes.map((n) => n.id);
  const links = (
    await sql<{ from_kind: string; from_id: string; relation: string; to_kind: string; to_id: string }>`
      select from_kind, from_id, relation, to_kind, to_id from lineage.link
      where from_id = any(${ids}::uuid[]) and to_id = any(${ids}::uuid[])`.execute(db)
  ).rows;
  const edges: Edge[] = links
    .map((l) => ({
      from: key(String(l.from_kind), String(l.from_id)),
      to: key(String(l.to_kind), String(l.to_id)),
      relation: l.relation as Edge['relation'],
    }))
    .filter((e) => shown.has(e.from) && shown.has(e.to));
  return { root, nodes, edges, truncated };
}
