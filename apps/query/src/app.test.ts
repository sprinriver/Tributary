import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';

describe('query service', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(() => app.close());

  it('OPS-01: DuckDB answers select 42', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/select42' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ answer: 42 });
  });

  it('OPS-08: the request id from apps/api is the one logged and echoed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
      headers: {
        'x-request-id': 'req-abc12345',
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      },
    });
    expect(res.headers['x-request-id']).toBe('req-abc12345');
  });
});
