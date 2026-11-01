import { sql } from 'kysely';
import type { Database } from './client.ts';

/** Role the query service reads metadata views as (migration 0014): SELECT on `query_meta` views only. */
export const QUERY_RO_ROLE = 'tributary_query_ro';

export const METADATA_KINDS = ['experiment_version', 'sample', 'file_object', 'pipeline_run'] as const;
export type MetadataKind = (typeof METADATA_KINDS)[number];

// A stable row order per view, so query pages break ties the same way every time.
const ORDER: Record<MetadataKind, string[]> = {
  experiment_version: ['experiment_version_id'],
  sample: ['experiment_version_id', 'position', 'sample_key'],
  file_object: ['created_at', 'file_id'],
  pipeline_run: ['pipeline_run_id'],
};

/**
 * Rows of a metadata view, scoped to programs (null = every program) and optionally to versions. Runs in a
 * read-only transaction as the read-only role; `columns` are contract column names (identifiers, not user input).
 */
export async function readMetadata(
  db: Database,
  kind: MetadataKind,
  columns: readonly string[],
  scope: { programIds: readonly string[] | null; experimentVersionIds?: readonly string[] | undefined },
): Promise<Record<string, unknown>[]> {
  if (scope.programIds?.length === 0 || scope.experimentVersionIds?.length === 0) return [];
  return db.transaction().execute(async (trx) => {
    await sql`set transaction read only`.execute(trx);
    await sql`set local role ${sql.id(QUERY_RO_ROLE)}`.execute(trx);
    const programs = scope.programIds ? sql`and program_id = any(${[...scope.programIds]}::uuid[])` : sql``;
    const versions = scope.experimentVersionIds
      ? sql`and experiment_version_id = any(${[...scope.experimentVersionIds]}::uuid[])`
      : sql``;
    const result = await sql<Record<string, unknown>>`
      select ${sql.join(columns.map((c) => sql.id(c)))}
      from ${sql.id('query_meta', kind)}
      where true ${programs} ${versions}
      order by ${sql.join(ORDER[kind].map((c) => sql.id(c)))}`.execute(trx);
    return result.rows;
  });
}
