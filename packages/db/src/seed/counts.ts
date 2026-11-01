import type { Database } from '../client.ts';
import type { DB } from '../generated/db.ts';

/** Tables whose row counts `pnpm db:seed` reports. */
export const COUNTED_TABLES = [
  'app_user',
  'assay_type',
  'metadata_template',
  'metadata_field_def',
  'program',
  'experiment',
  'experiment_version',
  'sample',
  'contrast',
  'file_object',
  'compound',
  'compound_property',
  'target_annotation',
  'audit_log',
] as const satisfies readonly (keyof DB)[];
export type SeedCounts = Record<(typeof COUNTED_TABLES)[number], number>;

export async function countRows(db: Database): Promise<SeedCounts> {
  const counts = {} as SeedCounts;
  for (const table of COUNTED_TABLES) {
    const { count } = await db
      .selectFrom(table)
      .select(db.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    counts[table] = Number(count);
  }
  return counts;
}
