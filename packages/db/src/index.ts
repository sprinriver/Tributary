export { APP_ROLE, createDb, DEFAULT_DATABASE_URL, IMMUTABLE_SQLSTATE, type Database } from './client.ts';
export type { DB } from './generated/db.ts';
export {
  COUNTED_TABLES,
  DEV_TENANT_ID,
  localStagingTarget,
  seedDatabase,
  type SeedCounts,
  type SeedOptions,
  type StagingTarget,
} from './seed/index.ts';
export { listMigrationNames, migrateDownAll, migrateToLatest, MIGRATIONS_DIR } from './migrator.ts';

/** Package name, exported so the workspace wiring can be tested. */
export const packageName = '@tributary/db';
