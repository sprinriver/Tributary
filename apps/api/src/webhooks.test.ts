import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeRunner } from './pipelines/fake.ts';
import { verifyWebhook } from './webhooks/signature.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** SPEC M13: HMAC-signed webhooks for run status. */
describe('webhooks (SPEC M13)', () => {
  let t: TestApi;
  let admin: string;
  const received: { url: string; headers: Record<string, string>; body: string }[] = [];
  const receiver: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://hooks.example.test/')) throw new Error(`unexpected fetch ${url}`);
    received.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: String(init?.body),
    });
    return new Response('ok', { status: url.endsWith('/down') ? 503 : 200 });
  }) as typeof fetch;

  beforeAll(async () => {
    t = await startTestApi({ fetch: receiver, runners: { fake: new FakeRunner() } });
    const adminUser = await t.user('wh-admin', {});
    const { tenant_id } = await t.db
      .selectFrom('app_user')
      .select('tenant_id')
      .where('id', '=', adminUser.id)
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
  });
  afterAll(() => t?.close());

  const create = (url: string) =>
    t.call(admin, {
      method: 'POST',
      url: '/v1/admin/webhooks',
      payload: { url, events: ['run.status'] },
      headers: { 'x-change-reason': 'test' },
    });

  it('API-02: a subscription returns its signing secret once; the list never shows it', async () => {
    const res = await create('https://hooks.example.test/a');
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json() as Json;
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{32,}$/);
    const list = (await t.call(admin, { method: 'GET', url: '/v1/admin/webhooks' })).json() as Json;
    const row = (list.items as Json[]).find((w) => w.id === created.id)!;
    expect(row).toMatchObject({ url: 'https://hooks.example.test/a', events: ['run.status'], active: true });
    expect(JSON.stringify(list)).not.toContain(created.secret);
    // Only https URLs (http only for localhost in development).
    expect((await create('http://hooks.example.test/plain')).statusCode).toBe(400);
  });

  it('API-02: deliveries are signed with HMAC-SHA256 over "timestamp.body"; tampering or replay fails verification', async () => {
    const { id, secret } = (await create('https://hooks.example.test/b')).json() as Json;
    received.length = 0;
    const ping = await t.call(admin, {
      method: 'POST',
      url: `/v1/admin/webhooks/${id}/ping`,
      headers: { 'x-change-reason': 'test' },
    });
    expect(ping.statusCode, ping.body).toBe(200);
    expect(ping.json()).toMatchObject({ status: 'delivered', response_status: 200 });
    const hit = received.find((r) => r.url.endsWith('/b'))!;
    expect(hit.headers['content-type']).toBe('application/json');
    expect(hit.headers['x-tributary-event']).toBe('ping');
    expect(hit.headers['x-tributary-delivery']).toMatch(/^[0-9a-f-]{36}$/);
    const header = hit.headers['x-tributary-signature']!;
    const [, ts, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header)!;
    expect(v1).toBe(createHmac('sha256', secret).update(`${ts}.${hit.body}`).digest('hex'));

    const now = Number(ts);
    expect(verifyWebhook(secret, header, hit.body, { now })).toBe(true);
    expect(verifyWebhook(secret, header, hit.body.replace('ping', 'pong'), { now })).toBe(false);
    expect(verifyWebhook('whsec_wrong', header, hit.body, { now })).toBe(false);
    // Older than the tolerance (5 minutes) is a replay.
    expect(verifyWebhook(secret, header, hit.body, { now: now + 301 })).toBe(false);
  });

  it('API-02: a run status change is delivered to subscribers; failures are recorded and retried', async () => {
    const ok = (await create('https://hooks.example.test/runs')).json() as Json;
    const down = (await create('https://hooks.example.test/down')).json() as Json;
    received.length = 0;
    const { notifyRunStatus } = await import('./webhooks/dispatch.ts');
    await notifyRunStatus(
      {
        db: t.db,
        fetch: receiver,
        tenantId: (await t.db.selectFrom('app_user').select('tenant_id').executeTakeFirstOrThrow()).tenant_id,
      },
      {
        run_id: '01a19699-12dc-7b76-b036-1569132f7088',
        status: 'succeeded',
        previous_status: 'running',
        pipeline_key: 'demo',
        experiment_version_id: null,
      },
    );
    const hit = received.find((r) => r.url.endsWith('/runs'))!;
    const body = JSON.parse(hit.body) as Json;
    expect(body).toMatchObject({
      event: 'run.status',
      data: { status: 'succeeded', previous_status: 'running' },
    });
    expect(verifyWebhook(ok.secret, hit.headers['x-tributary-signature']!, hit.body)).toBe(true);

    const deliveries = (
      await t.call(admin, { method: 'GET', url: `/v1/admin/webhooks/${down.id}/deliveries` })
    ).json() as Json;
    expect(deliveries.items[0]).toMatchObject({
      event: 'run.status',
      status: 'failed',
      response_status: 503,
    });
    expect(deliveries.items[0].attempts).toBeGreaterThanOrEqual(1);
  });
});
