import { describe, expect, it } from 'vitest';
import { fetchMe, loginHref } from './auth.ts';

describe('web auth helpers', () => {
  it('AUTH-01: a 401 from /me means signed out', async () => {
    const fakeFetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
    expect(await fetchMe(fakeFetch)).toBeNull();
  });

  it('AUTH-01: the login link returns to the current page', () => {
    expect(loginHref('/experiments?x=1')).toBe('/api/v1/auth/login?returnTo=%2Fexperiments%3Fx%3D1');
  });
});
