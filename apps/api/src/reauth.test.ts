import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { manifestRows } from './testing-data.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * SPEC M10 / §10 Part 11-ready controls: publishing and approving from a browser needs a recent sign-in
 * (OIDC max_age). API tokens are not interactive and are not asked to re-authenticate.
 */
describe('re-authentication on publish and approve', () => {
  let t: TestApi;
  let program: string;
  let userId: string;
  let token: string;

  const draft = async (name: string) => {
    const created = (
      await t.call(token, {
        method: 'POST',
        url: '/v1/experiments',
        payload: { program_id: program, assay_type: 'proteomics_dia', name },
        headers: { 'x-change-reason': 'test' },
      })
    ).json() as Json;
    const version = created.versions[0].id as string;
    await t.call(token, {
      method: 'PUT',
      url: `/v1/versions/${version}/samples`,
      payload: { rows: manifestRows() },
      headers: { 'x-change-reason': 'test' },
    });
    return version;
  };
  const session = async (minutesAgo: number) => {
    const s = await createSession(t.db, userId, {
      idToken: null,
      ttlHours: 4,
      authTime: new Date(Date.now() - minutesAgo * 60_000),
    });
    return { cookie: `trb_session=${s.cookieValue}`, 'x-csrf-token': s.csrfToken };
  };

  beforeAll(async () => {
    t = await startTestApi();
    program = await t.program('REA');
    ({ id: userId, token } = await t.user('rea-approver', { [program]: 'approver' }));
  });
  afterAll(async () => t?.close());

  it('AUD-02: publishing from a session signed in long ago asks to re-authenticate', async () => {
    const version = await draft('Reauth stale');
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      headers: await session(60),
      payload: { reason: 'ready' },
    });
    expect(res.statusCode, res.body).toBe(401);
    expect(res.json()).toMatchObject({ code: 'reauth_required' });
    const detail = (await t.call(token, { method: 'GET', url: `/v1/versions/${version}` })).json() as Json;
    expect(detail.status).toBe('draft');
    // Nothing was recorded for the refused attempt.
    const audit = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_id', '=', version)
      .where('action', '=', 'experiment_version.publish')
      .execute();
    expect(audit).toHaveLength(0);
  });

  it('AUD-02: a recent sign-in publishes; the audit row records the approver and reason', async () => {
    const version = await draft('Reauth fresh');
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      headers: await session(1),
      payload: { reason: 'checked and approved' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await t.db
      .selectFrom('audit_log')
      .select(['actor_id', 'reason'])
      .where('entity_id', '=', version)
      .where('action', '=', 'experiment_version.publish')
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ actor_id: userId, reason: 'checked and approved' });
  });

  it('AUD-02: API tokens publish without re-authentication (they are not interactive)', async () => {
    const version = await draft('Reauth token');
    const res = await t.call(token, {
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      payload: { reason: 'automation' },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('AUD-02: approving or rejecting a release and overriding QC need a recent sign-in too', async () => {
    const version = await draft('Reauth release');
    await t.call(token, {
      method: 'POST',
      url: `/v1/versions/${version}/publish`,
      payload: { reason: 'ready' },
    });
    const stale = await session(60);
    for (const url of [
      `/v1/releases/00000000-0000-7000-8000-000000000000/publish`,
      `/v1/releases/00000000-0000-7000-8000-000000000000/reject`,
    ]) {
      const res = await t.app.inject({ method: 'POST', url, headers: stale, payload: { reason: 'x' } });
      // Re-authentication is checked before the release is even looked up.
      expect(res.statusCode, `${url} ${res.body}`).toBe(401);
      expect((res.json() as Json).code).toBe('reauth_required');
    }
    const override = await t.app.inject({
      method: 'POST',
      url: `/v1/versions/${version}/qc-override`,
      headers: stale,
      payload: { reason: 'override reason long enough', file_ids: [] },
    });
    expect(override.statusCode, override.body).toBe(401);
  });

  it('AUD-02: /v1/auth/me reports when the session last authenticated', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/auth/me', headers: await session(5) });
    const body = res.json() as Json;
    expect(Date.parse(body.auth_time)).toBeGreaterThan(Date.now() - 6 * 60_000);
    expect(body.reauth_max_age_seconds).toBe(900);
  });
});

describe('auth_time from the ID token', () => {
  it('AUD-02: a missing auth_time counts as long ago (no silent sign-in passes as a fresh one)', async () => {
    const { authTimeFrom } = await import('./auth/oidc.ts');
    expect(authTimeFrom(1_800_000_000).toISOString()).toBe('2027-01-15T08:00:00.000Z');
    expect(authTimeFrom(undefined).getTime()).toBe(0);
    expect(authTimeFrom('1800000000').getTime()).toBe(0);
  });
});
