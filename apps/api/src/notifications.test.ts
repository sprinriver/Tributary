import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 31: team notifications to Slack and Microsoft Teams channels. Events are written to an outbox in the request
// and delivered by a background sweep (drained explicitly here), so a slow chat service never slows the app.
const SLACK = 'https://hooks.slack.com/services/T000/B000/secret-token';
const TEAMS = 'https://example.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi';

function chatStub() {
  const sent: { url: string; body: Json }[] = [];
  let failing = false;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://hooks.slack.com/') || url.includes('.webhook.office.com/')) {
      sent.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Json });
      return new Response(failing ? 'down' : 'ok', { status: failing ? 500 : 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { sent, fetchImpl, fail: (v: boolean) => (failing = v) };
}

describe('team notifications', () => {
  let t: TestApi;
  let admin: string;
  let scientist: string;
  let program: string;
  let other: string;
  const chat = chatStub();
  const create = (payload: Json, token = admin) =>
    t.call(token, {
      method: 'POST',
      url: '/v1/notification-routes',
      payload,
      headers: { 'x-change-reason': 'ops' },
    });

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true, fetch: chat.fetchImpl });
    program = await t.program('NTF');
    other = await t.program('NTX');
    const adminUser = await t.user('ntf-admin', {});
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
    scientist = (await t.user('ntf-scientist', { [program]: 'approver' })).token;
  }, 300_000);
  afterAll(() => t.close());

  let slackRoute: string;

  it('NOTIF-01: system admins add Slack and Teams routes; URLs are masked, checked and audited', async () => {
    expect(
      (await create({ name: 'x', kind: 'slack', url: SLACK, events: ['release.published'] }, scientist))
        .statusCode,
    ).toBe(403);
    const bad = await create({
      name: 'x',
      kind: 'slack',
      url: 'https://evil.example/hook',
      events: ['release.published'],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ code: 'unsupported_webhook_host', field: 'url' });
    const mismatch = await create({ name: 'x', kind: 'teams', url: SLACK, events: ['release.published'] });
    expect(mismatch.statusCode).toBe(422);
    const res = await create({
      name: 'NTF data',
      kind: 'slack',
      url: SLACK,
      program_id: program,
      events: ['release.published', 'version.published', 'triage.decision'],
    });
    expect(res.statusCode, res.body).toBe(201);
    const route = res.json() as Json;
    slackRoute = route.id;
    expect(route).toMatchObject({ kind: 'slack', program_code: 'NTF', active: true });
    expect(route.url_hint).toBe('https://hooks.slack.com/…');
    expect(JSON.stringify(route)).not.toContain('secret-token');
    const teams = await create({
      name: 'All programs',
      kind: 'teams',
      url: TEAMS,
      events: ['release.published'],
    });
    expect(teams.statusCode, teams.body).toBe(201);
    const list = (await t.call(admin, { method: 'GET', url: '/v1/notification-routes' })).json() as Json;
    expect(list.items).toHaveLength(2);
    const audit = await t.db
      .selectFrom('audit_log')
      .select(['action', 'after'])
      .where('entity_type', '=', 'notification_route')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['notification_route.create', 'notification_route.create']);
    expect(JSON.stringify(audit)).not.toContain('secret-token');
  });

  it('NOTIF-02: publishing sends names and a link (no data values) to routes of that program and to all-program routes', async () => {
    const otherRoute = await create({
      name: 'NTX only',
      kind: 'slack',
      url: SLACK,
      program_id: other,
      events: ['release.published'],
    });
    expect(otherRoute.statusCode).toBe(201);
    const { release } = await publishedDaRelease(t, scientist, program, 'Notified DA');
    expect(chat.sent).toHaveLength(0); // nothing is sent inside the request
    const delivered = await t.drainNotifications();
    expect(delivered).toBe(3); // NTF: version + release on Slack; all-program Teams: release
    const slack = chat.sent.filter((s) => s.url === SLACK).map((s) => s.body);
    expect(slack).toHaveLength(2);
    const releaseMsg = slack.find((b) => String(b.text).includes('released'))!;
    expect(releaseMsg.text).toContain('Notified DA');
    expect(JSON.stringify(releaseMsg)).toContain(`/releases/${release}`);
    const versionMsg = slack.find((b) => String(b.text).includes('published version'))!;
    expect(versionMsg.text).toContain('Notified DA');
    expect(JSON.stringify(versionMsg)).toContain('/experiments/'); // links to the experiment
    const teams = chat.sent.filter((s) => s.url === TEAMS).map((s) => s.body);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      type: 'message',
      attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive' }],
    });
    // No fold changes or p-values leave the account.
    expect(JSON.stringify(chat.sent)).not.toMatch(/log2|adj_p|p-value/i);
    const deliveries = (
      await t.call(admin, { method: 'GET', url: `/v1/notification-routes/${slackRoute}/deliveries` })
    ).json() as Json;
    expect(deliveries.items.map((d: Json) => d.status)).toEqual(['delivered', 'delivered']);
  });

  it('NOTIF-03: failed deliveries are retried with backoff, then marked failed; a test message reports its outcome', async () => {
    chat.fail(true);
    const item = await t.call(scientist, {
      method: 'POST',
      url: '/v1/triage',
      payload: { program_id: program, kind: 'protein', key: 'P04637', label: 'TP53' },
      headers: { 'x-change-reason': 'triage' },
    });
    const id = (item.json() as Json).id;
    await t.call(scientist, {
      method: 'PATCH',
      url: `/v1/triage/${id}`,
      payload: { status: 'advance', reason: 'Strong and consistent' },
      headers: { 'x-change-reason': 'triage' },
    });
    expect(await t.drainNotifications()).toBe(1); // one attempt
    const pending = await t.db
      .selectFrom('notification_delivery')
      .selectAll()
      .where('status', '=', 'pending')
      .execute();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ event: 'triage.decision', attempts: 1 });
    expect(await t.drainNotifications()).toBe(0); // backoff: not due yet
    const later = new Date(Date.now() + 24 * 3600_000);
    for (let i = 0; i < 6; i++) await t.drainNotifications(later);
    const failed = await t.db
      .selectFrom('notification_delivery')
      .selectAll()
      .where('id', '=', pending[0]!.id)
      .executeTakeFirstOrThrow();
    expect(failed).toMatchObject({ status: 'failed', attempts: 5, error: 'HTTP 500' });
    const triageMsg = chat.sent.at(-1)!.body;
    expect(triageMsg.text).toMatch(/TP53.*advance/);
    expect(triageMsg.text).toContain('Strong and consistent');

    const test = await t.call(admin, { method: 'POST', url: `/v1/notification-routes/${slackRoute}/test` });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ status: 'failed', error: 'HTTP 500' });
    chat.fail(false);
    expect(
      (await t.call(admin, { method: 'POST', url: `/v1/notification-routes/${slackRoute}/test` })).json(),
    ).toMatchObject({
      status: 'delivered',
    });
    // Deactivated routes get nothing; deleted routes are soft-deleted and audited.
    const off = await t.call(admin, {
      method: 'PATCH',
      url: `/v1/notification-routes/${slackRoute}`,
      payload: { active: false },
      headers: { 'x-change-reason': 'pause' },
    });
    expect((off.json() as Json).active).toBe(false);
    const del = await t.call(admin, {
      method: 'DELETE',
      url: `/v1/notification-routes/${slackRoute}`,
      headers: { 'x-change-reason': 'gone' },
    });
    expect(del.statusCode).toBe(204);
    const row = await t.db
      .selectFrom('notification_route')
      .select('deleted_at')
      .where('id', '=', slackRoute)
      .executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
  });
});
