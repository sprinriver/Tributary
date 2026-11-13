import { DEV_TENANT_ID } from '@tributary/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 36: usage analytics for admins, derived from the audit log and the registry (no new tracking, nothing
// leaves the account).
describe('usage analytics', () => {
  let t: TestApi;
  let admin: string;
  let scientist: { id: string; token: string };

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    const program = await t.program('UST');
    await t.program('USX'); // a program with no activity
    const a = await t.user('use-admin', {});
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: a.id,
        user_id: a.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = a.token;
    scientist = await t.user('use-scientist', { [program]: 'contributor' });
    await t.user('use-idle', { [program]: 'viewer' }); // never does anything
    await publishedDaRelease(t, scientist.token, program, 'Usage DA');
    // An action eight weeks ago lands in that week, not this one.
    await t.db
      .insertInto('audit_log')
      .values({
        tenant_id: DEV_TENANT_ID,
        actor_id: scientist.id,
        actor_type: 'user',
        action: 'experiment.create',
        entity_type: 'experiment',
        entity_id: scientist.id,
        request_id: 'test',
        at: new Date(Date.now() - 56 * 86_400_000),
      })
      .execute();
  }, 300_000);
  afterAll(() => t.close());

  const usage = (token: string, weeks = 12) =>
    t.call(token, { method: 'GET', url: `/v1/admin/usage?weeks=${weeks}` });

  it('USE-01: weekly activity comes from the audit log, oldest week first, with empty weeks as zeros', async () => {
    expect((await usage(scientist.token)).statusCode).toBe(403);
    const res = await usage(admin);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    expect(body.weekly).toHaveLength(12);
    const thisWeek = body.weekly.at(-1);
    expect(thisWeek).toMatchObject({
      experiments_created: 1,
      versions_published: 1,
      imports: 1,
      releases_published: 1,
      pipeline_runs: 0,
    });
    expect(thisWeek.active_users).toBe(1); // the scientist acted; the idle user did not
    const old = body.weekly.find((w: Json) => w.experiments_created === 1 && w !== thisWeek);
    expect(old).toBeDefined();
    expect(body.weekly.indexOf(old)).toBe(12 - 1 - 8);
    expect(
      body.weekly
        .slice(0, -1)
        .filter((w: Json) => w !== old)
        .every((w: Json) => w.active_users === 0),
    ).toBe(true);
    expect(body.figure.data.length).toBeGreaterThan(0);
    expect(body.definitions.active_users).toMatch(/audit log/);
  });

  it('USE-02: people and programs: totals, activity per program, and who has never been active', async () => {
    const body = (await usage(admin)).json() as Json;
    expect(body.totals).toMatchObject({ active_7d: 1, active_30d: 1 });
    expect(body.totals.users).toBeGreaterThanOrEqual(3);
    const ust = body.programs.find((p: Json) => p.program_code === 'UST');
    expect(ust).toMatchObject({
      experiments: 1,
      published_versions: 1,
      published_releases: 1,
      pipeline_runs: 0,
    });
    expect(ust.last_activity).not.toBeNull();
    expect(body.programs.find((p: Json) => p.program_code === 'USX')).toMatchObject({
      experiments: 0,
      last_activity: null,
    });
    const people = new Map(body.users.map((u: Json) => [u.name, u]));
    expect((people.get('use-scientist') as Json).actions_30d).toBeGreaterThan(3);
    expect(people.get('use-idle')).toMatchObject({ actions_30d: 0, last_active_at: null });
    expect((await usage(admin, 60)).statusCode).toBe(400); // at most 52 weeks
  });
});
