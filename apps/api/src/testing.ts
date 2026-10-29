import { createDb, DEV_TENANT_ID, migrateToLatest, type Database } from '@tributary/db';
import { startTestDatabase, type TestDatabase } from '@tributary/db/testing';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from './app.ts';
import { createPersonalAccessToken } from './auth/tokens.ts';
import { loadConfig, type ApiConfig } from './config.ts';

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
  call(token: string, options: InjectOptions): ReturnType<FastifyInstance['inject']>;
  close(): Promise<void>;
}

export async function startTestApi(): Promise<TestApi> {
  const testDb = await startTestDatabase();
  const db = createDb(testDb.url);
  await migrateToLatest(db);
  const app = buildApp({ db, config: testConfig() });
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
    async close() {
      await app.close();
      await db.destroy();
      await testDb.stop();
    },
  };
}
