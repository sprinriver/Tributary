import { createDb, DEV_TENANT_ID, migrateToLatest, type Database } from '@tributary/db';
import {
  startTestDatabase,
  startTestS3,
  TEST_S3_CREDENTIALS,
  type TestDatabase,
  type TestS3,
} from '@tributary/db/testing';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type AppOptions } from './app.ts';
import type { ModelProvider } from './ai/provider.ts';
import { createPersonalAccessToken } from './auth/tokens.ts';
import { loadConfig, type ApiConfig } from './config.ts';
import { MemoryIngestQueue } from './ingest/queue.ts';
import { sweepNotifications } from './notifications/sweep.ts';
import { MemoryMailer } from './notifications/mailer.ts';
import { buildApp as buildQueryApp } from '@tributary/query/app';
import { loadQueryConfig } from '@tributary/query/config';
import { Storage } from './storage.ts';
import { LocalDockerRunner } from './pipelines/local.ts';
import type { Runners } from './pipelines/runner.ts';
import { handleRunEvent, pollRuns } from './pipelines/service.ts';
import type { RunnerKind } from '@tributary/contracts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
  /** Sends the notifications due at `now` (default: now); returns how many attempts were made. */
  drainNotifications(now?: Date): Promise<number>;
  /** Emails sent so far (in-memory mailer). */
  emails: { to: string; subject: string; text: string }[];
  /** Makes the in-memory mailer fail (to test retries). */
  failEmails(fail: boolean): void;
  /** Pipeline status: one poll of every non-terminal run, or one EventBridge event as from SQS. */
  pipelines: { poll(): Promise<number>; event(message: object, runner?: RunnerKind): Promise<boolean> };
  close(): Promise<void>;
}

/** `fetch` replaces outbound HTTP (OLS4, apps/compute) so tests never touch the network. */
/** Routes calls to `config.queryUrl` into an in-process apps/query instance; everything else to `next`. */
function withQueryService(queryApp: FastifyInstance, queryUrl: string, next: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(queryUrl)) return next(input, init);
    const res: LightMyRequestResponse = await queryApp.inject({
      method: (init?.method ?? 'GET') as NonNullable<InjectOptions['method']>,
      url: url.slice(queryUrl.length),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(init?.body ? { payload: String(init.body) } : {}),
    });
    return new Response(res.body, {
      status: res.statusCode,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

export async function startTestApi(
  options: {
    fetch?: typeof fetch;
    s3?: boolean;
    query?: boolean;
    runners?: Runners;
    config?: Partial<ApiConfig>;
    /** Replaces the configured assistant model (e.g. a scripted provider). */
    aiProvider?: ModelProvider | null;
    /** Replaces IdP token introspection (MCP OAuth access tokens). */
    introspect?: AppOptions['introspect'];
  } = {},
): Promise<TestApi> {
  const [testDb, testS3] = await Promise.all([
    startTestDatabase(),
    options.s3 ? startTestS3() : Promise.resolve<TestS3 | undefined>(undefined),
  ]);
  const db = createDb(testDb.url);
  await migrateToLatest(db);
  const base = testConfig();
  const config = testConfig({
    ...options.config,
    s3: {
      ...base.s3,
      endpoint: testS3?.endpoint ?? 'http://127.0.0.1:1',
      credentials: TEST_S3_CREDENTIALS,
      rawBucket: 'test-raw',
    },
  });
  config.queryUrl = 'http://query.test';
  const storage = new Storage(config.s3);
  if (testS3) await storage.ensureBucket([config.publicUrl]);
  const queue = new MemoryIngestQueue();
  const mailer = new MemoryMailer();
  const queryApp = options.query
    ? await buildQueryApp({
        config: loadQueryConfig({
          NODE_ENV: 'test',
          S3_ENDPOINT: config.s3.endpoint,
          S3_ACCESS_KEY_ID: TEST_S3_CREDENTIALS.accessKeyId,
          S3_SECRET_ACCESS_KEY: TEST_S3_CREDENTIALS.secretAccessKey,
          QUERY_INTERNAL_TOKEN: config.queryInternalToken,
          DATABASE_URL: testDb.url,
        }),
      })
    : undefined;
  const outbound = options.fetch ?? fetch;
  const fetchImpl = queryApp ? withQueryService(queryApp, config.queryUrl, outbound) : outbound;
  const repoRoot = resolve(import.meta.dirname, '../../..');
  const runners: Runners = {
    local: new LocalDockerRunner(
      {
        image: 'nextflow/nextflow:25.10.0',
        repoRoot,
        fixturesDir: join(repoRoot, 'fixtures'),
        workRoot: mkdtempSync(join(tmpdir(), 'trb-runs-')),
      },
      storage,
    ),
    ...options.runners,
  };
  const app = buildApp({
    db,
    config,
    storage,
    ingestQueue: queue,
    fetch: fetchImpl,
    runners,
    ...(options.aiProvider === undefined ? {} : { aiProvider: options.aiProvider }),
    ...(options.introspect ? { introspect: options.introspect } : {}),
  });
  const pipelineDeps = { db, config, storage, fetch: fetchImpl, runners };
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
    drainNotifications: (now) => sweepNotifications({ db, fetch: fetchImpl, config, mailer }, now),
    emails: mailer.sent,
    failEmails: (fail) => mailer.fail(fail),
    pipelines: {
      poll: () => pollRuns(pipelineDeps),
      event: (message, runner) => handleRunEvent(pipelineDeps, message, runner),
    },
    async close() {
      await app.close();
      await queryApp?.close();
      await db.destroy();
      await Promise.all([testDb.stop(), testS3?.stop()]);
    },
  };
}
