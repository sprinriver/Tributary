import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease, topTable } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 34: personal email (alerts for watched items, triage assignments, finished runs). Emails go through an
// outbox like team notifications; tests capture them with an in-memory mailer.
describe('personal email notifications', () => {
  let t: TestApi;
  let program: string;
  let alice: { id: string; token: string };
  let bob: { id: string; token: string };
  const hit = topTable().find((r) => r.adjP <= 0.05 && Math.abs(r.logFC) >= 1)!;

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    program = await t.program('EML');
    alice = await t.user('eml-alice', { [program]: 'contributor' });
    bob = await t.user('eml-bob', { [program]: 'contributor' });
  }, 300_000);
  afterAll(() => t.close());

  const prefs = (token: string) => t.call(token, { method: 'GET', url: '/v1/me/notification-preferences' });
  const setPrefs = (token: string, payload: Json) =>
    t.call(token, {
      method: 'PUT',
      url: '/v1/me/notification-preferences',
      payload,
      headers: { 'x-change-reason': 'prefs' },
    });

  it('MAIL-01: everyone gets email for all personal events by default; changes are their own and audited', async () => {
    const res = await prefs(alice.token);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      email: true,
      events: ['alert.created', 'triage.assigned', 'run.finished'],
      address: 'eml-alice@example.test',
      email_available: true,
    });
    const off = await setPrefs(bob.token, { email: true, events: ['triage.assigned'] });
    expect(off.statusCode, off.body).toBe(200);
    expect((await prefs(bob.token)).json()).toMatchObject({ events: ['triage.assigned'] });
    expect((await prefs(alice.token)).json()).toMatchObject({
      events: ['alert.created', 'triage.assigned', 'run.finished'],
    });
    expect((await setPrefs(bob.token, { email: true, events: ['made.up'] })).statusCode).toBe(400);
    const audit = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('entity_type', '=', 'notification_preference')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['notification_preference.update']);
  });

  it('MAIL-02: a hit for a watched item emails the watcher (names and a link only), once per release', async () => {
    for (const u of [alice, bob])
      await t.call(u.token, {
        method: 'POST',
        url: '/v1/watches',
        payload: { kind: 'protein', key: hit.id },
      });
    const { release } = await publishedDaRelease(t, alice.token, program, 'Emailed DA');
    expect(t.emails).toHaveLength(0); // nothing is sent inside the request
    await t.drainNotifications();
    const mails = t.emails.filter((m) => m.subject.includes('watched'));
    expect(mails.map((m) => m.to)).toEqual(['eml-alice@example.test']); // bob turned alert emails off
    expect(mails[0]!.subject).toMatch(/1 new hit for your watched items/);
    expect(mails[0]!.text).toContain(hit.id);
    expect(mails[0]!.text).toContain(`/releases/${release}`);
    // No data values in email. IDs are removed first: a UUID such as …8dfe-58… looks like 1e-5 to the pattern.
    const withoutIds = mails[0]!.text.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '<id>',
    );
    expect(withoutIds).not.toMatch(/log2|adj|p-value|e-\d/i);
  });

  it('MAIL-03: assigning a triage item emails the new owner (not oneself); failed sends retry', async () => {
    const item = (
      await t.call(alice.token, {
        method: 'POST',
        url: '/v1/triage',
        payload: { program_id: program, kind: 'protein', key: 'P04637', label: 'TP53' },
        headers: { 'x-change-reason': 'triage' },
      })
    ).json() as Json;
    const assign = (token: string, owner: string) =>
      t.call(token, {
        method: 'PATCH',
        url: `/v1/triage/${item.id}`,
        payload: { owner_id: owner },
        headers: { 'x-change-reason': 'assign' },
      });
    t.emails.length = 0;
    await assign(alice.token, alice.id); // to oneself: no email
    t.failEmails(true);
    await assign(alice.token, bob.id);
    expect(await t.drainNotifications()).toBe(1);
    expect(t.emails).toHaveLength(0);
    t.failEmails(false);
    await t.drainNotifications(new Date(Date.now() + 3600_000));
    expect(t.emails.map((m) => [m.to, m.subject])).toEqual([
      ['eml-bob@example.test', 'Tributary: TP53 (P04637) was assigned to you by eml-alice'],
    ]);
    const row = await t.db
      .selectFrom('email_delivery')
      .select(['status', 'attempts'])
      .where('to_address', '=', 'eml-bob@example.test')
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'delivered', attempts: 2 });
  });
});
