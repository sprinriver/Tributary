import { HealthStatusSchema } from '@tributary/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('api health endpoints', () => {
  const app = buildApp();
  afterAll(() => app.close());

  it('OPS-01: GET /healthz returns a valid health payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(HealthStatusSchema.parse(res.json())).toMatchObject({ service: 'api', status: 'ok' });
  });

  it('OPS-01: GET /readyz returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });
});
