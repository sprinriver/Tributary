import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './generated/db.ts';

export type Database = Kysely<DB>;

/** The role apps/api and workers run as (granted to their login user). Soft delete only; audit_log append-only. */
export const APP_ROLE = 'tributary_app';

/** SQLSTATE raised when something published or append-only would change (apps/api maps it to HTTP 409). */
export const IMMUTABLE_SQLSTATE = 'TR409';

export const DEFAULT_DATABASE_URL = 'postgres://tributary:tributary-dev@localhost:5432/tributary';

// bigint columns (row counts, file sizes) come back as numbers; refuse silently losing precision.
pg.types.setTypeParser(pg.types.builtins.INT8, (text: string) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError(`bigint ${text} exceeds Number.MAX_SAFE_INTEGER`);
  return value;
});

// date columns stay 'YYYY-MM-DD' strings: a JS Date would shift them by the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (text: string) => text);

export function createDb(
  connectionString: string = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
): Database {
  const pool = new pg.Pool({ connectionString });
  // A connection the server closes (restart, failover, shutdown) must not crash the process: node-postgres emits
  // 'error' on idle and closing clients, which is fatal without a listener. The next query reconnects.
  const warn = (error: Error) => console.warn(`postgres connection closed: ${error.message}`);
  pool.on('error', warn);
  pool.on('connect', (client) => client.on('error', warn));
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
