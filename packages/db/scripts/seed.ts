// `pnpm db:seed` — loads fixtures/ (from `pnpm synth`) into the local database and stages files in SeaweedFS.
// Run `pnpm db:migrate` first. Running it again changes nothing.
import { resolve } from 'node:path';
import { createDb, localStagingTarget, seedDatabase } from '../src/index.ts';

const fixturesDir = resolve(import.meta.dirname, '../../../fixtures');
const db = createDb();
try {
  const counts = await seedDatabase(db, { fixturesDir, staging: localStagingTarget() });
  console.log('db:seed: row counts');
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table.padEnd(20)} ${count}`);
} finally {
  await db.destroy();
}
