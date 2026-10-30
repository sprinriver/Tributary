import { PgBoss } from 'pg-boss';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from '@tributary/db';
import { PgBossIngestQueue, startIngestWorker } from './ingest/queue.ts';
import { Storage } from './storage.ts';

const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '127.0.0.1';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const storage = new Storage(config.s3);
// Local development: the raw bucket and browser CORS for the SPA origin (on AWS, infra/terraform owns both).
if (!config.production) await storage.ensureBucket([config.publicUrl]);

// The pg-boss schema is created by migration 0007, so the client never migrates it.
const boss = new PgBoss({ connectionString: config.databaseUrl, migrate: false, createSchema: false });
boss.on('error', (error) => app.log.error(error, 'pg-boss'));
await boss.start();
await startIngestWorker(boss, { db, storage });

const app = buildApp({
  db,
  config,
  storage,
  ingestQueue: new PgBossIngestQueue(boss),
  server: { logger: true },
});
app.addHook('onClose', async () => {
  await boss.stop({ graceful: true });
  await db.destroy();
});
await app.listen({ port, host });
