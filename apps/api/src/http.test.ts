import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

describe('HTTP edge cases', () => {
  let t: TestApi;
  let token: string;
  beforeAll(async () => {
    t = await startTestApi();
    const program = await t.program('H1');
    token = (await t.user('http', { [program]: 'contributor' })).token;
  });
  afterAll(() => t.close());

  it('REG-04: an empty JSON body is treated as no body', async () => {
    const res = await t.call(token, {
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    // Logout needs a browser session; the point is that the empty body itself is not a 400 parse error.
    expect(res.json()).toMatchObject({ code: 'not_a_session' });
  });

  it('REG-04: a malformed id is a 400, not a 500', async () => {
    const res = await t.call(token, { method: 'GET', url: '/v1/versions/undefined' });
    expect(res.statusCode).toBe(400);
  });
});
