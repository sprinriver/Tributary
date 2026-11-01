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
});
