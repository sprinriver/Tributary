import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** SPEC M11 admin: programs, picklists, ontology sources, IdP group mapping, system health. */
describe('admin settings (SPEC M11)', () => {
  let t: TestApi;
  let program: string;
  let contributor: string;
  let admin: string;
  let tenant: string;

  const as = (token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: Json) =>
    t.call(token, { method, url, ...(payload ? { payload } : {}), headers: { 'x-change-reason': 'test' } });
  const audited = async (action: string) =>
    (await t.db.selectFrom('audit_log').select('action').where('action', '=', action).execute()).length;

  beforeAll(async () => {
    // Compute, query and the IdP are unreachable here: health must report them, not fail.
    t = await startTestApi({ fetch: (async () => Promise.reject(new Error('unreachable'))) as typeof fetch });
    program = await t.program('ADM');
    contributor = (await t.user('adm-contributor', { [program]: 'contributor' })).token;
    const adminUser = await t.user('adm-admin', {});
    tenant = (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id;
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: tenant,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
  });
  afterAll(async () => t?.close());

  it('ADM-02: admins create and edit programs (audited); others get 403; codes are unique', async () => {
    const created = await as(admin, 'POST', '/v1/admin/programs', {
      code: 'NEWP',
      name: 'New programme',
      description: 'For tests',
      requires_approval: true,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ code: 'NEWP', name: 'New programme', requires_approval: true });
    const id = (created.json() as Json).id as string;
    expect((await as(admin, 'POST', '/v1/admin/programs', { code: 'NEWP', name: 'Again' })).statusCode).toBe(
      409,
    );
    expect((await as(admin, 'POST', '/v1/admin/programs', { code: 'bad code', name: 'x' })).statusCode).toBe(
      400,
    );
    const patched = await as(admin, 'PATCH', `/v1/admin/programs/${id}`, {
      name: 'Renamed',
      requires_approval: false,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ name: 'Renamed', requires_approval: false });
    expect(
      (await as(contributor, 'POST', '/v1/admin/programs', { code: 'NOPE', name: 'x' })).statusCode,
    ).toBe(403);
    expect(await audited('program.create')).toBe(1);
    expect(await audited('program.update')).toBe(1);
  });

  it('ADM-02: picklists have built-in defaults until an admin sets them; values are validated', async () => {
    const species = (await as(contributor, 'GET', '/v1/picklists?kind=species')).json() as Json;
    expect(species).toMatchObject({ kind: 'species', built_in: true });
    expect(species.values).toEqual(
      expect.arrayContaining([{ value: 'NCBITaxon:9606', label: 'Homo sapiens' }]),
    );

    const put = await as(admin, 'PUT', '/v1/admin/picklists/time_point', {
      values: [
        { value: '2 h', label: '2 h' },
        { value: '24 h', label: '24 h' },
      ],
    });
    expect(put.statusCode, put.body).toBe(200);
    const times = (await as(contributor, 'GET', '/v1/picklists?kind=time_point')).json() as Json;
    expect(times).toMatchObject({ built_in: false, values: [{ value: '2 h' }, { value: '24 h' }] });
    // Replacing the list removes values that are no longer in it.
    await as(admin, 'PUT', '/v1/admin/picklists/time_point', { values: [{ value: '48 h', label: '48 h' }] });
    expect(((await as(contributor, 'GET', '/v1/picklists?kind=time_point')).json() as Json).values).toEqual([
      { value: '48 h', label: '48 h' },
    ]);

    const badTime = await as(admin, 'PUT', '/v1/admin/picklists/time_point', {
      values: [{ value: 'soon', label: 'soon' }],
    });
    expect(badTime.statusCode).toBe(422);
    expect((badTime.json() as Json).field).toBe('values.0.value');
    const badSpecies = await as(admin, 'PUT', '/v1/admin/picklists/species', {
      values: [{ value: 'human', label: 'Human' }],
    });
    expect(badSpecies.statusCode).toBe(422);
    expect((await as(contributor, 'PUT', '/v1/admin/picklists/time_point', { values: [] })).statusCode).toBe(
      403,
    );
    expect(await audited('picklist.update')).toBe(2);
  });

  it('ADM-02: admins choose which ontology sources the manifest editor may look up', async () => {
    const before = (await as(admin, 'GET', '/v1/admin/ontology-sources')).json() as Json;
    expect(before.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ prefix: 'EFO', enabled: true })]),
    );
    expect(before.ols_url).toEqual(expect.any(String));
    const put = await as(admin, 'PUT', '/v1/admin/ontology-sources', {
      enabled: ['NCBITaxon', 'cellosaurus'],
    });
    expect(put.statusCode, put.body).toBe(200);
    const after = (await as(admin, 'GET', '/v1/admin/ontology-sources')).json() as Json;
    expect((after.sources as Json[]).find((s) => s.prefix === 'EFO').enabled).toBe(false);
    const lookup = await as(contributor, 'GET', '/v1/ontology/search?ontology=EFO&q=asthma');
    expect(lookup.statusCode).toBe(422);
    expect((lookup.json() as Json).code).toBe('ontology_disabled');
    expect(await audited('settings.ontology_sources')).toBe(1);
    await as(admin, 'PUT', '/v1/admin/ontology-sources', {
      enabled: (before.sources as Json[]).map((s) => s.prefix),
    });
  });

  it('ADM-03: IdP group → role mappings stored by admins grant roles at sign-in', async () => {
    const put = await as(admin, 'PUT', '/v1/admin/group-mappings', {
      items: [{ group: 'qa-team', role: 'viewer', programs: ['ADM'] }],
    });
    expect(put.statusCode, put.body).toBe(200);
    const list = (await as(admin, 'GET', '/v1/admin/group-mappings')).json() as Json;
    expect(list.items).toEqual([{ group: 'qa-team', role: 'viewer', programs: ['ADM'] }]);
    expect(list.from_config).toEqual(expect.any(Array));

    // A user in the IdP group "qa-team" (mirrored at sign-in) now reads the program.
    const qa = await t.user('adm-qa', {});
    const group = await t.db
      .insertInto('app_group')
      .values({ tenant_id: tenant, created_by: qa.id, name: 'qa-team' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('group_member')
      .values({ tenant_id: tenant, created_by: qa.id, group_id: group.id, user_id: qa.id })
      .execute();
    const me = (await as(qa.token, 'GET', '/v1/auth/me')).json() as Json;
    expect(me.roles).toEqual([expect.objectContaining({ program_id: program, role: 'viewer' })]);

    const bad = await as(admin, 'PUT', '/v1/admin/group-mappings', {
      items: [{ group: 'x', role: 'owner', programs: [] }],
    });
    expect(bad.statusCode).toBe(400);
    expect(await audited('settings.group_mappings')).toBe(1);
  });

  it('ADM-03: system health reports each dependency without failing when one is down', async () => {
    const res = await as(admin, 'GET', '/v1/admin/health');
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    const check = (name: string) => (body.checks as Json[]).find((c) => c.name === name);
    expect(check('database')).toMatchObject({ status: 'ok' });
    expect(check('compute_service')).toMatchObject({ status: 'down' });
    expect(check('query_service')).toMatchObject({ status: 'down' });
    expect(check('identity_provider')).toMatchObject({ status: 'down' });
    expect(check('search_index')).toMatchObject({ status: 'ok' });
    expect(body.status).toBe('degraded');
    expect(body.runners).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'local' })]));
    expect(body.ai).toEqual({ enabled: false, provider: 'none' });
    expect((await as(contributor, 'GET', '/v1/admin/health')).statusCode).toBe(403);
  });
});
