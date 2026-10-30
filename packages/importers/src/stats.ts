import type { DatasetContract } from '@tributary/contracts';
import type { DuckDBConnection } from '@duckdb/node-api';
import { ident } from './sql.ts';
import type { ColumnStats } from './types.ts';

const ORDERED = new Set(['double', 'integer', 'date', 'timestamp']);

const plain = (value: unknown): number | string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' || typeof value === 'string') return value;
  return String(value);
};

/** Null count, distinct count and min/max (ordered types) per canonical column. */
export async function columnStats(
  conn: DuckDBConnection,
  contract: DatasetContract,
  table: string,
): Promise<Record<string, ColumnStats>> {
  const parts = contract.columns.flatMap((c) => {
    const col = ident(c.name);
    const base = [`count(*) - count(${col})`, `count(DISTINCT ${col})`];
    return ORDERED.has(c.type) ? [...base, `min(${col})::VARCHAR`, `max(${col})::VARCHAR`] : base;
  });
  const row = (await conn.runAndReadAll(`SELECT ${parts.join(', ')} FROM ${table}`)).getRows()[0]!;
  const stats: Record<string, ColumnStats> = {};
  let i = 0;
  for (const c of contract.columns) {
    const entry: ColumnStats = { null_count: Number(row[i++]), distinct_count: Number(row[i++]) };
    if (ORDERED.has(c.type)) {
      const numeric = c.type === 'double' || c.type === 'integer';
      const min = plain(row[i++]);
      const max = plain(row[i++]);
      entry.min = numeric && min !== null ? Number(min) : min;
      entry.max = numeric && max !== null ? Number(max) : max;
    }
    stats[c.name] = entry;
  }
  return stats;
}
