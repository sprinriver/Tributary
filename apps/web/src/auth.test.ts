import { describe, expect, it } from 'vitest';
import { fetchMe, loginHref, retryMe } from './auth.ts';

describe('web auth helpers', () => {
  it('AUTH-01: a 401 from /me means signed out', async () => {
    const fakeFetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
    expect(await fetchMe(fakeFetch)).toBeNull();
  });

  it('AUTH-01: a transient /me failure is retried, then reported', async () => {
    const fakeFetch = (async () => new Response(null, { status: 502 })) as typeof fetch;
    await expect(fetchMe(fakeFetch)).rejects.toThrow(/HTTP 502/);
    expect([0, 1, 2].map(retryMe)).toEqual([true, true, true]);
    expect(retryMe(3)).toBe(false);
  });

  it('AUTH-01: the login link returns to the current page', () => {
    expect(loginHref('/experiments?x=1')).toBe('/api/v1/auth/login?returnTo=%2Fexperiments%3Fx%3D1');
  });
});
