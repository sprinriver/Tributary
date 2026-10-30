import { createDb, DEV_TENANT_ID, migrateToLatest, type Database } from '@tributary/db';
import {
  startTestDatabase,
  startTestS3,
  TEST_S3_CREDENTIALS,
  type TestDatabase,
  type TestS3,
} from '@tributary/db/testing';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.ts';
import { createPersonalAccessToken } from './auth/tokens.ts';
import { loadConfig, type ApiConfig } from './config.ts';
import { MemoryIngestQueue } from './ingest/queue.ts';
import { Storage } from './storage.ts';

/** Configuration for API tests: dev defaults, no IdP group mapping. */
export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return { ...loadConfig({ NODE_ENV: 'test' }), groupRoleMap: [], ...overrides };
}

/** A migrated test database, an app on it, and helpers to create programs and users with PATs. */
export interface TestApi {
  testDb: TestDatabase;
  db: Database;
  app: FastifyInstance;
  program(code: string, options?: { requiresApproval?: boolean }): Promise<string>;
  /** Creates a user with role bindings and returns a read/write PAT for them. */
  user(name: string, roles: Record<string, string>): Promise<{ id: string; token: string }>;
  call(token: string, options: InjectOptions): Promise<LightMyRequestResponse>;
  /** Object storage (a SeaweedFS container when started with `{ s3: true }`). */
  s3: { client: Storage['client']; bucket: string };
  /** Runs the ingest jobs queued so far; returns how many ran. */
  drainIngest(): Promise<number>;
  close(): Promise<void>;
}

/** `fetch` replaces outbound HTTP (OLS4, apps/compute) so tests never touch the network. */
export async function startTestApi(options: { fetch?: typeof fetch; s3?: boolean } = {}): Promise<TestApi> {
  const [testDb, testS3] = await Promise.all([
    startTestDatabase(),
    options.s3 ? startTestS3() : Promise.resolve<TestS3 | undefined>(undefined),
  ]);
  const db = createDb(testDb.url);
  await migrateToLatest(db);
  const base = testConfig();
  const config = testConfig({
    s3: {
      ...base.s3,
      endpoint: testS3?.endpoint ?? 'http://127.0.0.1:1',
      credentials: TEST_S3_CREDENTIALS,
      rawBucket: 'test-raw',
    },
  });
  const storage = new Storage(config.s3);
  if (testS3) await storage.ensureBucket([config.publicUrl]);
  const queue = new MemoryIngestQueue();
  const app = buildApp({
    db,
    config,
    storage,
    ingestQueue: queue,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    testDb,
    db,
    app,
    async program(code, options = {}) {
      const row = await db
        .insertInto('program')
        .values({
          tenant_id: DEV_TENANT_ID,
          created_by: DEV_TENANT_ID,
          name: code,
          code,
          requires_approval: options.requiresApproval ?? false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    async user(name, roles) {
      const { id } = await db
        .insertInto('app_user')
        .values({
          tenant_id: DEV_TENANT_ID,
          created_by: DEV_TENANT_ID,
          sub: `test|${name}`,
          email: `${name}@example.test`,
          name,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const [programId, role] of Object.entries(roles)) {
        await db
          .insertInto('role_binding')
          .values({ tenant_id: DEV_TENANT_ID, created_by: id, user_id: id, program_id: programId, role })
          .execute();
      }
      const { token } = await createPersonalAccessToken(db, id, {
        name: 'test',
        scopes: ['read', 'write'],
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      return { id, token };
    },
    call(token, options) {
      return app.inject({ ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } });
    },
    s3: { client: storage.client, bucket: storage.bucket },
    drainIngest: () => queue.drain({ db, storage }),
    async close() {
      await app.close();
      await db.destroy();
      await Promise.all([testDb.stop(), testS3?.stop()]);
    },
  };
}
