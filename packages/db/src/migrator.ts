import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { Migrator, NO_MIGRATIONS, type Migration, type MigrationResultSet } from 'kysely/migration';

/** Each migration is a folder `NNNN_name/` holding `up.sql` and `down.sql`. Committed migrations are never edited. */
export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');

export function listMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}_[a-z0-9_]+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

const sqlMigration = (name: string): Migration => {
  const run = (file: string) => async (db: Kysely<unknown>) => {
    await sql.raw(readFileSync(join(MIGRATIONS_DIR, name, file), 'utf8')).execute(db);
  };
  return { up: run('up.sql'), down: run('down.sql') };
};

function migrator(db: Kysely<unknown>): Migrator {
  return new Migrator({
    db,
    provider: {
      getMigrations: async () =>
        Object.fromEntries(listMigrationNames().map((name) => [name, sqlMigration(name)])),
    },
  });
}

function namesOrThrow({ error, results }: MigrationResultSet): string[] {
  const failed = results?.find((r) => r.status === 'Error');
  if (error) {
    const where = failed ? ` in ${failed.migrationName} (${failed.direction})` : '';
    throw new Error(`Migration failed${where}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  return (results ?? []).map((r) => r.migrationName);
}

/** Applies all pending migrations, each in its own transaction; returns the names applied. */
export async function migrateToLatest<T>(db: Kysely<T>): Promise<string[]> {
  return namesOrThrow(await migrator(db as Kysely<unknown>).migrateToLatest());
}

/** Rolls back every migration (newest first); returns the names rolled back. Development and tests only. */
export async function migrateDownAll<T>(db: Kysely<T>): Promise<string[]> {
  return namesOrThrow(await migrator(db as Kysely<unknown>).migrateTo(NO_MIGRATIONS));
}
