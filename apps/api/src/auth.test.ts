import { createDb, DEV_TENANT_ID, migrateToLatest, type Database } from '@tributary/db';
import { startTestDatabase, type TestDatabase } from '@tributary/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';
import { createSession } from './auth/sessions.ts';
import { createPersonalAccessToken, revokePersonalAccessToken } from './auth/tokens.ts';
import { testConfig } from './testing.ts';

describe('authentication, roles and audit', () => {
  let testDb: TestDatabase;
  let db: Database;
  let app: FastifyInstance;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  async function user(name: string): Promise<string> {
    const row = await db
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
    return row.id;
  }
  async function bind(userId: string, programId: string, role: string) {
    await db
      .insertInto('role_binding')
      .values({ tenant_id: DEV_TENANT_ID, created_by: userId, user_id: userId, program_id: programId, role })
      .execute();
  }
  const bearer = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    testDb = await startTestDatabase();
    db = createDb(testDb.url);
    await migrateToLatest(db);
    for (const code of ['P1', 'P2']) {
      const p = await db
        .insertInto('program')
        .values({ tenant_id: DEV_TENANT_ID, created_by: DEV_TENANT_ID, name: code, code })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids[code] = p.id;
    }
    for (const name of ['viewer', 'contributor', 'outsider']) ids[name] = await user(name);
    await bind(ids.viewer!, ids.P1!, 'viewer');
    await bind(ids.contributor!, ids.P1!, 'contributor');
    await bind(ids.outsider!, ids.P2!, 'contributor');
    const inAnHour = new Date(Date.now() + 3_600_000);
    for (const name of ['viewer', 'contributor', 'outsider']) {
      tokens[name] = (
        await createPersonalAccessToken(db, ids[name]!, {
          name: 'test',
          scopes: ['read', 'write'],
          expiresAt: inAnHour,
        })
      ).token;
    }
    tokens.readOnly = (
      await createPersonalAccessToken(db, ids.contributor!, {
        name: 'ro',
        scopes: ['read'],
        expiresAt: inAnHour,
      })
    ).token;
    app = buildApp({ db, config: testConfig() });
  });
  afterAll(async () => {
    await app.close();
    await db.destroy();
    await testDb.stop();
  });

  const createExperiment = (headers: Record<string, string>, programId = ids.P1) =>
    app.inject({
      method: 'POST',
      url: '/v1/experiments',
      headers: { ...headers, 'x-change-reason': 'initial registration' },
      payload: { program_id: programId, assay_type: 'proteomics_dia', name: 'Dose series' },
    });

  it('AUTH-02: unauthenticated requests get 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('AUTH-02: a PAT authenticates GET /v1/auth/me and lists program roles', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer('contributor') });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { name: 'contributor', email: 'contributor@example.test' },
      roles: [{ program_id: ids.P1, role: 'contributor' }],
    });
  });

  it('AUTH-02: viewer gets 403 on POST /v1/experiments; contributor gets 201', async () => {
    const denied = await createExperiment(bearer('viewer'));
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'forbidden' });
    const created = await createExperiment(bearer('contributor'));
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Dose series', program_id: ids.P1 });
  });

  it('AUTH-02: cross-program reads and writes are denied', async () => {
    const created = (await createExperiment(bearer('contributor'))).json() as { id: string };
    const read = await app.inject({
      method: 'GET',
      url: `/v1/experiments/${created.id}`,
      headers: bearer('outsider'),
    });
    expect(read.statusCode).toBe(403);
    const write = await createExperiment(bearer('contributor'), ids.P2);
    expect(write.statusCode).toBe(403);
    const own = await app.inject({
      method: 'GET',
      url: `/v1/experiments/${created.id}`,
      headers: bearer('viewer'),
    });
    expect(own.statusCode).toBe(200);
  });

  it('AUTH-02: a read-scoped PAT cannot mutate', async () => {
    const res = await createExperiment(bearer('readOnly'));
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'insufficient_scope' });
  });

  it('AUTH-02: a revoked PAT is rejected', async () => {
    const { token, id } = await createPersonalAccessToken(db, ids.contributor!, {
      name: 'to revoke',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const before = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);
    await revokePersonalAccessToken(db, ids.contributor!, id);
    const after = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('AUTH-02: an expired PAT is rejected', async () => {
    const { token } = await createPersonalAccessToken(db, ids.contributor!, {
      name: 'expired',
      scopes: ['read'],
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('AUTH-02: a PAT can be created and revoked through the API', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/auth/tokens',
      headers: bearer('contributor'),
      payload: { name: 'notebook', scopes: ['read'], expires_in_days: 30 },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string; token: string };
    expect(body.token).toMatch(/^trb_/);
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/tokens/${body.id}`,
      headers: bearer('contributor'),
    });
    expect(revoked.statusCode).toBe(204);
    const use = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(use.statusCode).toBe(401);
  });

  it('AUTH-02: cookie sessions need the CSRF token for mutations', async () => {
    const session = await createSession(db, ids.contributor!, { idToken: null, ttlHours: 1 });
    const cookie = { cookie: `trb_session=${session.cookieValue}` };
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: cookie });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ csrf_token: session.csrfToken });
    const without = await createExperiment(cookie);
    expect(without.statusCode).toBe(403);
    expect(without.json()).toMatchObject({ code: 'csrf' });
    const withToken = await createExperiment({ ...cookie, 'x-csrf-token': session.csrfToken });
    expect(withToken.statusCode).toBe(201);
  });

  it('AUD-01: a mutation writes an audit row with actor, action, before/after and reason', async () => {
    const created = (await createExperiment(bearer('contributor'))).json() as { id: string };
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/experiments/${created.id}`,
      headers: { ...bearer('contributor'), 'x-change-reason': 'typo in name' },
      payload: { name: 'Dose series (corrected)' },
    });
    expect(renamed.statusCode).toBe(200);

    const rows = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('entity_id', '=', created.id)
      .orderBy('at')
      .execute();
    expect(rows.map((r) => r.action)).toEqual(['experiment.create', 'experiment.update']);
    const [create, update] = rows;
    expect(create).toMatchObject({
      actor_id: ids.contributor,
      actor_type: 'user',
      reason: 'initial registration',
      before: null,
    });
    expect(create?.after).toMatchObject({ name: 'Dose series' });
    expect(update).toMatchObject({ actor_id: ids.contributor, reason: 'typo in name' });
    expect(update?.before).toMatchObject({ name: 'Dose series' });
    expect(update?.after).toMatchObject({ name: 'Dose series (corrected)' });
    expect(update?.request_id).toBeTruthy();
  });

  it('AUD-01: a failed (forbidden) mutation writes no audit row', async () => {
    const before = await db
      .selectFrom('audit_log')
      .select(db.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    await createExperiment(bearer('viewer'));
    const after = await db
      .selectFrom('audit_log')
      .select(db.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});
