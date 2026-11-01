import type { PgBoss } from 'pg-boss';
import { runIngest, type IngestDeps } from './job.ts';

export const INGEST_QUEUE = 'file-ingest';

/** Where the API puts files to ingest. Production: pg-boss; tests: in memory, drained explicitly. */
export interface IngestQueue {
  enqueue(fileId: string): Promise<void>;
}

export class PgBossIngestQueue implements IngestQueue {
  readonly #boss: PgBoss;
  constructor(boss: PgBoss) {
    this.#boss = boss;
  }
  async enqueue(fileId: string): Promise<void> {
    await this.#boss.send(
      INGEST_QUEUE,
      { fileId },
      { singletonKey: fileId, retryLimit: 3, retryBackoff: true },
    );
  }
}

/** Runs ingest jobs from pg-boss in this process (SPEC M3: ingest state machine on pg-boss). */
export async function startIngestWorker(boss: PgBoss, deps: IngestDeps): Promise<void> {
  await boss.createQueue(INGEST_QUEUE);
  await boss.work<{ fileId: string }>(INGEST_QUEUE, async (jobs) => {
    for (const job of jobs) await runIngest(deps, job.data.fileId);
  });
}

export class MemoryIngestQueue implements IngestQueue {
  readonly pending: string[] = [];
  async enqueue(fileId: string): Promise<void> {
    this.pending.push(fileId);
  }
  /** Runs every queued job (in order); returns how many ran. */
  async drain(deps: IngestDeps): Promise<number> {
    let ran = 0;
    while (this.pending.length) {
      await runIngest(deps, this.pending.shift()!);
      ran++;
    }
    return ran;
  }
}
