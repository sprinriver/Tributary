import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLimiter } from './rate-limit.ts';
import { startTestApi, type TestApi } from './testing.ts';

describe('rate limiter', () => {
  it('SEC-03: allows up to the limit per key and window, then says how long to wait; other keys are unaffected', () => {
    let now = 1_000_000;
    const limiter = createLimiter({ windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i++) expect(limiter.take('a', 3)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.take('a', 3)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now += 45_000;
    expect(limiter.take('a', 3)).toEqual({ allowed: false, retryAfterSeconds: 15 });
    expect(limiter.take('b', 3).allowed).toBe(true);
    now += 15_000; // a new window
    expect(limiter.take('a', 3).allowed).toBe(true);
  });

  it('SEC-03: forgets finished windows, so memory does not grow with the number of clients', () => {
    let now = 0;
    const limiter = createLimiter({ windowMs: 1_000, now: () => now });
    for (let i = 0; i < 500; i++) limiter.take(`k${i}`, 1);
    expect(limiter.size()).toBe(500);
    now += 5_000;
    limiter.take('fresh', 1);
    expect(limiter.size()).toBe(1);
  });
});

describe('API rate limiting', () => {
  let t: TestApi;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    t = await startTestApi({ config: { rateLimit: { perMinute: 5, anonymousPerMinute: 3 } } });
    const program = await t.program('RLM');
    alice = (await t.user('rl-alice', { [program]: 'viewer' })).token;
    bob = (await t.user('rl-bob', { [program]: 'viewer' })).token;
  }, 300_000);
  afterAll(() => t.close());

  it('SEC-03: a token over its limit gets 429 with Retry-After; another token and health checks are unaffected', async () => {
    const me = (token: string) => t.call(token, { method: 'GET', url: '/v1/auth/me' });
    for (let i = 0; i < 5; i++) expect((await me(alice)).statusCode).toBe(200);
    const limited = await me(alice);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await me(bob)).statusCode).toBe(200);
    for (let i = 0; i < 10; i++)
      expect((await t.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it('SEC-03: requests without credentials share a lower limit per client address (guessing tokens is limited too)', async () => {
    const anonymous = () => t.app.inject({ method: 'GET', url: '/v1/programs' });
    for (let i = 0; i < 3; i++) expect((await anonymous()).statusCode).toBe(401);
    expect((await anonymous()).statusCode).toBe(429);
    // A wrong token is a different key from no token, but still limited per token.
    const wrong = () =>
      t.app.inject({ method: 'GET', url: '/v1/programs', headers: { authorization: 'Bearer trb_wrong' } });
    for (let i = 0; i < 5; i++) expect((await wrong()).statusCode).toBe(401);
    expect((await wrong()).statusCode).toBe(429);
  });
});
