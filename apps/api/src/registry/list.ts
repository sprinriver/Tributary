import type { ListExperimentsQuery } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { sql, type RawBuilder } from 'kysely';
import { HttpError } from '../errors.ts';

const SORT_COLUMNS = {
  name: { expr: sql`e.name`, cast: sql`text` },
  created_at: { expr: sql`e.created_at`, cast: sql`timestamptz` },
  updated_at: { expr: sql`e.updated_at`, cast: sql`timestamptz` },
  // Undated experiments sort first ascending, last descending.
  experiment_date: { expr: sql`coalesce(cur.experiment_date, '0001-01-01'::date)`, cast: sql`date` },
} as const;

interface Cursor {
  v: string;
  id: string;
}
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decodeCursor(text: string): Cursor {
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Cursor;
    if (typeof value.v === 'string' && typeof value.id === 'string') return value;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'invalid_cursor', 'The cursor is not valid for this list.', 'cursor');
}

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Experiments with their current (highest) version and latest published version number. Filters, sort and keyset
 * pagination are parameterized SQL; `programs` (null = all) scopes the list to what the caller may read.
 */
export async function listExperiments(db: Database, query: ListExperimentsQuery, programs: string[] | null) {
  const sortKey = query.sort ?? 'created_at';
  const dir = query.dir ?? (sortKey === 'name' ? 'asc' : 'desc');
  const limit = query.limit ?? 25;
  const sort = SORT_COLUMNS[sortKey];
  const where: RawBuilder<unknown>[] = [sql`e.deleted_at is null`];

  if (programs) where.push(programs.length ? sql`e.program_id = any(${programs}::uuid[])` : sql`false`);
  if (query.program_id) where.push(sql`e.program_id = ${query.program_id}`);
  if (query.assay_type) where.push(sql`e.assay_type = ${query.assay_type}`);
  if (query.date_from) where.push(sql`cur.experiment_date >= ${query.date_from}::date`);
  if (query.date_to) where.push(sql`cur.experiment_date <= ${query.date_to}::date`);
  if (query.name) where.push(sql`e.name ilike ${likePattern(query.name)}`);
  if (query.q) {
    where.push(
      sql`(cur.search_tsv @@ websearch_to_tsquery('simple', ${query.q}) or e.name ilike ${likePattern(query.q)})`,
    );
  }
  if (query.status) where.push(sql`cur.status = ${query.status}`);
  if (query.include_archived !== 'true') where.push(sql`e.archived_at is null`);
  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    const op = dir === 'asc' ? sql`>` : sql`<`;
    where.push(sql`(${sort.expr}, e.id) ${op} (${cursor.v}::${sort.cast}, ${cursor.id}::uuid)`);
  }
  const order = dir === 'asc' ? sql`asc` : sql`desc`;

  const { rows } = await sql<Record<string, unknown> & { id: string; sort_value: unknown }>`
    with cur as (
      select distinct on (v.experiment_id) v.*
      from experiment_version v
      where v.deleted_at is null
      order by v.experiment_id, v.version_number desc
    )
    select e.id, e.name, e.urn, e.assay_type, e.program_id, p.code as program_code, e.created_at, e.updated_at,
      e.archived_at,
      (select lp.version_number from experiment_version lp
        where lp.experiment_id = e.id and lp.is_latest_published) as latest_published_version,
      json_build_object(
        'id', cur.id, 'version_number', cur.version_number, 'status', cur.status,
        'parent_version_id', cur.parent_version_id, 'experiment_date', cur.experiment_date,
        'species', cur.species, 'spectral_library', cur.spectral_library, 'time_points', cur.time_points
      ) as current_version,
      -- Latest pipeline run of the current version and whether it has published results (SPEC M4 list parity).
      (select json_build_object('id', r.id, 'status', r.status, 'pipeline_key', d.key)
        from pipeline_run r join pipeline_definition d on d.id = r.pipeline_definition_id
        where r.experiment_version_id = cur.id and r.deleted_at is null
        order by r.created_at desc limit 1) as latest_run,
      exists (select 1 from dataset ds join dataset_release dr on dr.dataset_id = ds.id
        where ds.experiment_version_id = cur.id and dr.status = 'published' and ds.deleted_at is null) as has_results,
      ${sort.expr}::text as sort_value
    from experiment e
    join program p on p.id = e.program_id
    join cur on cur.experiment_id = e.id
    where ${sql.join(where, sql` and `)}
    order by ${sort.expr} ${order}, e.id ${order}
    limit ${limit + 1}
  `.execute(db);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ sort_value: _sortValue, ...item }) => item),
    next_cursor:
      rows.length > limit && last ? encodeCursor({ v: String(last.sort_value), id: last.id }) : null,
  };
}
