// `pnpm gen` step: migrate a throwaway Postgres container, then write src/generated/db.ts with kysely-codegen.
// Uses a container rather than the local stack so the output never depends on local data.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createDb, migrateToLatest } from '../src/index.ts';
import { startTestDatabase } from '../src/testing/postgres.ts';

const root = resolve(import.meta.dirname, '..');
const testDb = await startTestDatabase();
try {
  const db = createDb(testDb.url);
  await migrateToLatest(db);
  await db.destroy();
  const result = spawnSync(
    resolve(root, 'node_modules/.bin/kysely-codegen'),
    [
      '--dialect=postgres',
      `--url=${testDb.url}`,
      '--out-file=src/generated/db.ts',
      '--exclude-pattern={kysely_*,pgboss.*}',
      '--type-mapping={"int8":"number","date":"string"}',
    ],
    { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await testDb.stop();
}
