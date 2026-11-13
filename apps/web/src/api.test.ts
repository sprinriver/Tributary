import { describe, expect, it } from 'vitest';
import { api, ApiError, buildUrl } from './api.ts';
import { fetchMe } from './auth.ts';

const ME = {
  user: { id: '01a19acc-804b-750b-a4df-b0582b0ff218', name: 'A', email: 'a@example.org', kind: 'human' },
  roles: [],
  auth: 'session',
  csrf_token: 'tok-123',
  reauth_max_age_seconds: 900,
};

describe('typed API client', () => {
  it('REG-02: builds list URLs with encoded params and non-empty query values', () => {
    expect(buildUrl('/v1/versions/{id}/diff/{otherId}', { id: 'a b', otherId: 'c' })).toBe(
      '/api/v1/versions/a%20b/diff/c',
    );
    expect(buildUrl('/v1/experiments', {}, { q: 'dose', name: '', limit: 25 })).toBe(
      '/api/v1/experiments?q=dose&limit=25',
    );
  });

  it('REG-03: turns error bodies into ApiError with the contract fields', async () => {
    const fakeFetch = (async () =>
      Response.json(
        { code: 'reason_required', field: 'reason', message: 'Say why' },
        { status: 400 },
      )) as typeof fetch;
    const error = await api('publishVersion', { params: { id: 'x' }, body: {} }, fakeFetch).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toMatchObject({ code: 'reason_required', field: 'reason' });
  });

  it('AUTH-01: a mutation sent while /v1/auth/me is loading waits for its CSRF token', async () => {
    let answerMe: (r: Response) => void = () => undefined;
    const meFetch = (() => new Promise<Response>((r) => (answerMe = r))) as unknown as typeof fetch;
    const me = fetchMe(meFetch);
    const sent: (string | null)[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get('x-csrf-token'));
      return Response.json({});
    }) as unknown as typeof fetch;
    const call = api(
      'searchCompounds',
      { body: { query: 'c1ccccc1', mode: 'substructure' } },
      fakeFetch,
    ).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual([]); // still waiting for /v1/auth/me
    answerMe(Response.json(ME));
    await me;
    await call;
    expect(sent).toEqual(['tok-123']);
  });
});
