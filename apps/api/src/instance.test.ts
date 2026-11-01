import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, testConfig, type TestApi } from './testing.ts';
import { loadConfig } from './config.ts';

/** Self-hosted public demo: the SPA learns from the API whether this instance is a demo and which logins it offers. */
describe('instance information', () => {
  let regular: TestApi;
  let demo: TestApi;

  beforeAll(async () => {
    [regular, demo] = await Promise.all([
      startTestApi(),
      startTestApi({
        config: {
          instance: {
            name: 'Tributary demo',
            demo: true,
            demoLogins: [
              { username: 'scientist', password: 'scientist' },
              { username: 'viewer', password: 'viewer' },
            ],
            notice: 'Synthetic data only; reset every night.',
          },
        },
      }),
    ]);
  });
  afterAll(async () => {
    await regular?.close();
    await demo?.close();
  });

  it('OSS-01: GET /v1/instance is public and says "not a demo" by default', async () => {
    const res = await regular.app.inject({ method: 'GET', url: '/v1/instance' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Tributary', demo: false, demo_logins: [], notice: null });
  });

  it('OSS-01: a demo instance lists its demo logins and notice', async () => {
    const res = await demo.app.inject({ method: 'GET', url: '/v1/instance' });
    expect(res.json()).toMatchObject({
      name: 'Tributary demo',
      demo: true,
      demo_logins: [
        { username: 'scientist', password: 'scientist' },
        { username: 'viewer', password: 'viewer' },
      ],
      notice: 'Synthetic data only; reset every night.',
    });
  });

  it('OSS-01: DEMO_MODE, DEMO_LOGINS and INSTANCE_NAME configure it; demo logins never include admins', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DEMO_MODE: 'true',
      INSTANCE_NAME: 'Acme demo',
      DEMO_LOGINS: 'scientist:s3cret, viewer:viewer',
      DEMO_NOTICE: 'Resets nightly',
    });
    expect(config.instance).toEqual({
      name: 'Acme demo',
      demo: true,
      demoLogins: [
        { username: 'scientist', password: 's3cret' },
        { username: 'viewer', password: 'viewer' },
      ],
      notice: 'Resets nightly',
    });
    expect(() => loadConfig({ NODE_ENV: 'test', DEMO_MODE: 'true', DEMO_LOGINS: 'admin:admin' })).toThrow(
      /admin/,
    );
    expect(testConfig().instance.demo).toBe(false);
  });
});
