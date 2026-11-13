import { DEV_TENANT_ID } from '@tributary/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Phase 37: a support bundle an admin can send to support: versions, migrations, health, a configuration summary,
// counts and recent failures. Never secrets, never personal data; the download is audited.
const SECRETS = {
  cookieSecret: 'cookie-secret-must-not-leak-1234567890',
  oidcSecret: 'oidc-client-secret-must-not-leak',
  queryToken: 'query-internal-token-must-not-leak',
  smtpUrl: 'smtps://mailer:smtp-password-must-not-leak@smtp.example.org:465',
};

describe('support bundle', () => {
  let t: TestApi;
  let admin: string;
  let scientist: string;

  beforeAll(async () => {
    const base = (await import('./config.ts')).loadConfig({ NODE_ENV: 'test' });
    t = await startTestApi({
      config: {
        cookieSecret: SECRETS.cookieSecret,
        queryInternalToken: SECRETS.queryToken,
        oidc: { ...base.oidc, clientSecret: SECRETS.oidcSecret },
        email: {
          transport: 'smtp',
          from: 'Tributary <no-reply@example.org>',
          smtpUrl: SECRETS.smtpUrl,
          sesRegion: 'eu-west-1',
        },
      },
    });
    const program = await t.program('SUP');
    const a = await t.user('sup-admin', {});
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
    const s = await t.user('sup-scientist', { [program]: 'contributor' });
    scientist = s.token;
    // A failed channel delivery and a failed email in the last week.
    const route = await t.db
      .insertInto('notification_route')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: a.id,
        name: 'Lab',
        kind: 'slack',
        url: 'https://hooks.slack.com/services/T/B/route-secret',
        events: ['run.finished'],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('notification_delivery')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: a.id,
        route_id: route.id,
        event: 'run.finished',
        title: 'x',
        message: '{}',
        status: 'failed',
        attempts: 5,
        error: 'HTTP 500',
      })
      .execute();
    await t.db
      .insertInto('email_delivery')
      .values({
        tenant_id: DEV_TENANT_ID,
        created_by: a.id,
        user_id: s.id,
        event: 'run.finished',
        to_address: 'sup-scientist@example.test',
        subject: 'Tributary: x',
        body: 'x',
        status: 'failed',
        attempts: 5,
        error: 'send failed',
      })
      .execute();
  }, 300_000);
  afterAll(() => t.close());

  const bundle = (token: string) => t.call(token, { method: 'GET', url: '/v1/admin/support-bundle' });

  it('SUP-01: versions, migrations, health, configuration summary, counts and recent failures; admins only', async () => {
    expect((await bundle(scientist)).statusCode).toBe(403);
    const res = await bundle(admin);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="tributary-support-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const body = res.json() as Json;
    expect(body.instance.version).toMatch(/\d/);
    expect(body.instance.node).toMatch(/^v\d+/);
    expect(body.database.migrations_applied).toContain('0026_scim');
    expect(body.database.migrations_pending).toEqual([]);
    expect(body.health.checks.length).toBeGreaterThan(0);
    expect(body.configuration).toMatchObject({ email_transport: 'smtp', email_configured: true });
    expect(body.counts).toMatchObject({ programs: 1, notification_routes: 1 });
    expect(body.recent_failures.notification_deliveries).toMatchObject({
      count: 1,
      latest: [{ event: 'run.finished', error: 'HTTP 500' }],
    });
    expect(body.recent_failures.emails).toMatchObject({
      count: 1,
      latest: [{ event: 'run.finished', error: 'send failed' }],
    });
  });

  it('SUP-01: no secrets, no personal data, and the download is audited', async () => {
    const text = (await bundle(admin)).body;
    for (const secret of [...Object.values(SECRETS), 'smtp-password-must-not-leak', 'route-secret'])
      expect(text).not.toContain(secret);
    expect(text).not.toContain('@example.test'); // no email addresses
    expect(text).not.toContain('sup-scientist'); // no names
    const audit = await t.db
      .selectFrom('audit_log')
      .select('action')
      .where('action', '=', 'support.bundle')
      .execute();
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
