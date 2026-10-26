// `pnpm db:migrate` → migrate to latest; `pnpm db:migrate down` → roll everything back (local development only).
import { createDb, migrateDownAll, migrateToLatest } from '../src/index.ts';

const direction = process.argv[2] ?? 'up';
const db = createDb();
try {
  const names = direction === 'down' ? await migrateDownAll(db) : await migrateToLatest(db);
  console.log(names.length ? `${direction}: ${names.join(', ')}` : 'db:migrate: already up to date');
} finally {
  await db.destroy();
}
