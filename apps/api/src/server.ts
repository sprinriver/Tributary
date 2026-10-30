import { PgBoss } from 'pg-boss';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from '@tributary/db';
import { PgBossIngestQueue, startIngestWorker } from './ingest/queue.ts';
import { Storage } from './storage.ts';
import { resolve } from 'node:path';
import { LocalDockerRunner } from './pipelines/local.ts';
import type { Runners } from './pipelines/runner.ts';
import { handleRunEvent, pollRuns } from './pipelines/service.ts';
import { consumeOnce } from './pipelines/sqs.ts';
import { SQSClient } from '@aws-sdk/client-sqs';

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

// Pipeline runners: local Nextflow-in-Docker in development; AWS adapters are configured in Phase 21 deployments.
const repoRoot = resolve(import.meta.dirname, '../../..');
const runners: Runners = config.production
  ? {}
  : {
      local: new LocalDockerRunner(
        {
          image: process.env.NEXTFLOW_IMAGE ?? 'nextflow/nextflow:25.10.0',
          repoRoot,
          fixturesDir: resolve(repoRoot, 'fixtures'),
          workRoot: process.env.LOCAL_RUNS_DIR ?? resolve(repoRoot, '.runs'),
        },
        storage,
      ),
    };
// Poller fallback for run status (SPEC M4): every minute via pg-boss's scheduler.
await boss.createQueue('runs-poll');
await boss.schedule('runs-poll', '* * * * *');
await boss.work('runs-poll', async () => {
  await pollRuns({ db, config, storage, fetch, runners });
});

const app = buildApp({
  db,
  config,
  storage,
  runners,
  ingestQueue: new PgBossIngestQueue(boss),
  server: { logger: true },
});
app.addHook('onClose', async () => {
  await boss.stop({ graceful: true });
  await db.destroy();
});
// EventBridge → SQS run status events (SPEC M4), when a queue is configured (AWS deployments).
const queueUrl = process.env.RUN_EVENTS_QUEUE_URL;
let stopping = false;
app.addHook('onClose', async () => {
  stopping = true;
});
if (queueUrl) {
  const sqs = new SQSClient({ region: config.s3.region });
  void (async () => {
    while (!stopping) {
      await consumeOnce(sqs, queueUrl, (m) =>
        handleRunEvent({ db, config, storage, fetch, runners }, m),
      ).catch((error: unknown) => app.log.error({ error }, 'run events'));
    }
  })();
}
await app.listen({ port, host });
