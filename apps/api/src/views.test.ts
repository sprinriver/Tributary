import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('saved views', () => {
  let t: TestApi;
  let program: string;
  let owner: string;
  let colleague: string;
  let outsider: string;
  const spec = { source: { kind: 'sample', scope: {} }, select: ['sample_key'] };

  beforeAll(async () => {
    t = await startTestApi();
    program = await t.program('VWS');
    const other = await t.program('VWO');
    owner = (await t.user('view-owner', { [program]: 'contributor' })).token;
    colleague = (await t.user('view-colleague', { [program]: 'viewer' })).token;
    outsider = (await t.user('view-outsider', { [other]: 'contributor' })).token;
  }, 300_000);
  afterAll(() => t.close());

  const create = (token: string, payload: Json) =>
    t.call(token, { method: 'POST', url: '/v1/views', payload, headers: { 'x-change-reason': 'saved' } });
  const get = (token: string, id: string) => t.call(token, { method: 'GET', url: `/v1/views/${id}` });

  it('EXP-04: private views are visible to their owner only; program views to the program', async () => {
    const mine = await create(owner, { name: 'My samples', query_spec: spec, visibility: 'private' });
    expect(mine.statusCode, mine.body).toBe(201);
    const view = mine.json() as Json;
    expect(view).toMatchObject({
      name: 'My samples',
      visibility: 'private',
      program_id: null,
      query_spec: spec,
    });
    expect((await get(owner, view.id)).statusCode).toBe(200);
    expect((await get(colleague, view.id)).statusCode).toBe(404);

    const shared = (
      await create(owner, {
        name: 'Team samples',
        query_spec: spec,
        visibility: 'program',
        program_id: program,
      })
    ).json() as Json;
    expect((await get(colleague, shared.id)).statusCode).toBe(200);
    expect((await get(outsider, shared.id)).statusCode).toBe(404);
    const list = (await t.call(colleague, { method: 'GET', url: '/v1/views' })).json() as Json;
    expect(list.items.map((v: Json) => v.id)).toEqual([shared.id]);

    // Sharing to a program needs write access there; a viewer cannot publish a view to it.
    const denied = await create(colleague, {
      name: 'x',
      query_spec: spec,
      visibility: 'program',
      program_id: program,
    });
    expect(denied.statusCode).toBe(403);
    expect(
      (await create(owner, { name: 'x', query_spec: { ...spec, sql: 'select 1' }, visibility: 'private' }))
        .statusCode,
    ).toBe(400);
  });

  it('EXP-04: delete is soft, owner-only and audited', async () => {
    const view = (
      await create(owner, { name: 'Temp', query_spec: spec, visibility: 'private' })
    ).json() as Json;
    expect((await t.call(colleague, { method: 'DELETE', url: `/v1/views/${view.id}` })).statusCode).toBe(404);
    const res = await t.call(owner, {
      method: 'DELETE',
      url: `/v1/views/${view.id}`,
      headers: { 'x-change-reason': 'not needed' },
    });
    expect(res.statusCode).toBe(204);
    expect((await get(owner, view.id)).statusCode).toBe(404);
    const row = await t.db
      .selectFrom('saved_view')
      .select('deleted_at')
      .where('id', '=', view.id)
      .executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
    const actions = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', view.id)
      .orderBy('at')
      .orderBy('id')
      .execute();
    expect(actions.map((a) => a.action)).toEqual(['view.create', 'view.delete']);
  });
});
