import { describe, expect, it } from 'vitest';
import { api, ApiError, buildUrl } from './api.ts';

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
});
