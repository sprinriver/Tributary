import { DEV_TENANT_ID } from '@tributary/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertLoginUser } from './auth/login-user.ts';
import { createPersonalAccessToken } from './auth/tokens.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 35: SCIM 2.0 provisioning (RFC 7643/7644) so identity providers create, update and deactivate users and
// groups. A system admin's token with the `scim` scope authenticates; groups grant roles through group mappings.
const USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

describe('SCIM provisioning', () => {
  let t: TestApi;
  let scim: string;
  let program: string;
  let plainAdminToken: string;

  beforeAll(async () => {
    t = await startTestApi({});
    program = await t.program('SCM');
    const admin = await t.user('scim-admin', {});
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: admin.id,
        user_id: admin.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    plainAdminToken = admin.token;
    scim = (
      await createPersonalAccessToken(t.db, admin.id, {
        name: 'idp',
        scopes: ['scim'],
        expiresAt: new Date(Date.now() + 3_600_000),
      })
    ).token;
    // Members of the IdP group "scm-scientists" become contributors in SCM.
    await t.db
      .insertInto('group_role_mapping')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: admin.id,
        group_name: 'scm-scientists',
        role: 'contributor',
        programs: ['SCM'],
      })
      .execute();
  }, 300_000);
  afterAll(() => t.close());

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Json,
    token = scim,
  ) =>
    t.app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });
  let userId: string;
  let groupId: string;

  it('SCIM-01: an IdP creates, finds, updates and lists users; only a scim-scoped admin token is accepted', async () => {
    const config = await call('GET', '/scim/v2/ServiceProviderConfig');
    expect(config.statusCode).toBe(200);
    expect(config.json()).toMatchObject({ patch: { supported: true }, filter: { supported: true } });
    expect((await call('GET', '/scim/v2/Users', undefined, plainAdminToken)).statusCode).toBe(403);
    // A provisioning token reads nothing elsewhere: not the API, not the MCP endpoint.
    expect((await t.call(scim, { method: 'GET', url: '/v1/programs' })).statusCode).toBe(403);
    const mcp = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${scim}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(mcp.statusCode).toBe(401);
    const created = await call('POST', '/scim/v2/Users', {
      schemas: [USER],
      userName: 'Ada.Lovelace@example.org',
      externalId: 'idp-ada',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
      emails: [{ value: 'ada.lovelace@example.org', primary: true }],
      active: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers['content-type']).toMatch(/application\/scim\+json/);
    const user = created.json() as Json;
    userId = user.id;
    expect(user).toMatchObject({
      schemas: [USER],
      userName: 'Ada.Lovelace@example.org',
      externalId: 'idp-ada',
      displayName: 'Ada Lovelace',
      active: true,
      meta: { resourceType: 'User' },
    });
    const dup = await call('POST', '/scim/v2/Users', {
      schemas: [USER],
      userName: 'ada.lovelace@example.org',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ scimType: 'uniqueness', status: '409' });
    const found = (
      await call(
        'GET',
        '/scim/v2/Users?filter=' + encodeURIComponent('userName eq "ada.lovelace@example.org"'),
      )
    ).json() as Json;
    expect(found).toMatchObject({ totalResults: 1, Resources: [{ id: userId }] });
    const none = (
      await call('GET', '/scim/v2/Users?filter=' + encodeURIComponent('externalId eq "nobody"'))
    ).json() as Json;
    expect(none).toMatchObject({ totalResults: 0, Resources: [] });
    const renamed = await call('PATCH', `/scim/v2/Users/${userId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'Replace', path: 'displayName', value: 'Ada King' }],
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((renamed.json() as Json).displayName).toBe('Ada King');
    const page = (await call('GET', '/scim/v2/Users?startIndex=1&count=1')).json() as Json;
    expect(page).toMatchObject({ startIndex: 1, itemsPerPage: 1 });
    expect(page.totalResults).toBeGreaterThanOrEqual(2);
    const audit = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', userId)
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['scim.user.create', 'scim.user.update']);
  });

  it('SCIM-02: groups grant roles through group mappings; membership changes apply at once', async () => {
    const created = await call('POST', '/scim/v2/Groups', {
      schemas: [GROUP],
      displayName: 'scm-scientists',
      externalId: 'idp-group-1',
      members: [{ value: userId }],
    });
    expect(created.statusCode, created.body).toBe(201);
    groupId = (created.json() as Json).id;
    expect(created.json()).toMatchObject({ displayName: 'scm-scientists', members: [{ value: userId }] });
    const bindings = async () => {
      const { loadBindings } = await import('./auth/principal.ts');
      const { loadConfig } = await import('./config.ts');
      return (
        await loadBindings(t.db, { ...loadConfig({ NODE_ENV: 'test' }), groupRoleMap: [] }, userId)
      ).filter((b) => b.program_id === program);
    };
    expect((await bindings()).map((b) => b.role)).toEqual(['contributor']);
    const removed = await call('PATCH', `/scim/v2/Groups/${groupId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'remove', path: `members[value eq "${userId}"]` }],
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await bindings()).toEqual([]);
    await call('PATCH', `/scim/v2/Groups/${groupId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'add', path: 'members', value: [{ value: userId }] }],
    });
    expect((await bindings()).map((b) => b.role)).toEqual(['contributor']);
  });

  it('SCIM-03: signing in links to the provisioned user; IdP group claims do not undo SCIM memberships', async () => {
    const linked = await t.db.transaction().execute((trx) =>
      upsertLoginUser(trx, DEV_TENANT_ID, {
        sub: 'oidc|ada',
        email: 'ADA.LOVELACE@example.org',
        name: 'Ada King',
        groups: [],
      }),
    );
    expect(linked).toBe(userId);
    const member = await t.db
      .selectFrom('group_member')
      .select('id')
      .where('user_id', '=', userId)
      .where('group_id', '=', groupId)
      .where('deleted_at', 'is', null)
      .execute();
    expect(member).toHaveLength(1);
    // A second login with the same sub is the same user (no second link).
    const again = await t.db.transaction().execute((trx) =>
      upsertLoginUser(trx, DEV_TENANT_ID, {
        sub: 'oidc|ada',
        email: 'ada.lovelace@example.org',
        name: 'Ada',
        groups: [],
      }),
    );
    expect(again).toBe(userId);
  });

  it('SCIM-04: deactivating a user ends their access at once; reactivation restores it; DELETE removes them', async () => {
    const { token } = await createPersonalAccessToken(t.db, userId, {
      name: 'ada',
      scopes: ['read'],
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const me = () => t.call(token, { method: 'GET', url: '/v1/auth/me' });
    expect((await me()).statusCode).toBe(200);
    const off = await call('PATCH', `/scim/v2/Users/${userId}`, {
      schemas: [PATCH],
      Operations: [{ op: 'replace', value: { active: 'False' } }], // Entra ID sends booleans as strings
    });
    expect(off.statusCode, off.body).toBe(200);
    expect((off.json() as Json).active).toBe(false);
    expect((await me()).statusCode).toBe(401);
    await call('PUT', `/scim/v2/Users/${userId}`, {
      schemas: [USER],
      userName: 'Ada.Lovelace@example.org',
      externalId: 'idp-ada',
      displayName: 'Ada King',
      emails: [{ value: 'ada.lovelace@example.org', primary: true }],
      active: true,
    });
    expect((await me()).statusCode).toBe(200);
    expect((await call('DELETE', `/scim/v2/Users/${userId}`)).statusCode).toBe(204);
    expect((await call('GET', `/scim/v2/Users/${userId}`)).statusCode).toBe(404);
    expect((await me()).statusCode).toBe(401);
    const row = await t.db
      .selectFrom('app_user')
      .select(['deleted_at'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull(); // soft delete
  });
});
