import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSERTION_HEADER, signAssertion } from './auth/assertion.ts';
import { startTestApi, type TestApi } from './testing.ts';
import { isPrivateAddress } from './webhooks/address.ts';

/** Phase 20 review fixes: in-process assertions, OAuth scopes, webhook SSRF guard. */
describe('MCP and webhook security', () => {
  let t: TestApi;
  let userId: string;
  let program: string;
  let sub: string;

  beforeAll(async () => {
    t = await startTestApi({
      introspect: async (token) =>
        token === 'no-scope'
          ? { active: true, sub, aud: ['http://localhost:5173/api/mcp'], scope: 'openid profile' }
          : { active: false },
    });
    program = await t.program('SEC');
    const user = await t.user('sec-user', { [program]: 'contributor' });
    userId = user.id;
    sub = (await t.db.selectFrom('app_user').select('sub').where('id', '=', userId).executeTakeFirstOrThrow())
      .sub;
  });
  afterAll(() => t?.close());

  const asAssertion = (
    value: string,
    method: 'GET' | 'POST' = 'GET',
    url = '/v1/auth/me',
    payload?: object,
  ) => t.app.inject({ method, url, headers: { [ASSERTION_HEADER]: value }, ...(payload ? { payload } : {}) });

  it('MCP-02: a forged, tampered or expired in-process assertion is rejected', async () => {
    expect((await asAssertion(signAssertion(userId, ['read']))).statusCode).toBe(200);
    const [payload, sig] = signAssertion(userId, ['read']).split('.');
    const elevated = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), s: ['read', 'write'] }),
    ).toString('base64url');
    expect((await asAssertion(`${elevated}.${sig}`)).statusCode).toBe(401);
    expect((await asAssertion(`${payload}.forged`)).statusCode).toBe(401);
    expect((await asAssertion(signAssertion(userId, ['read'], Date.now() - 120_000))).statusCode).toBe(401);
  });

  it('MCP-02: an assertion carries no more than its scopes', async () => {
    const res = await asAssertion(signAssertion(userId, ['read']), 'POST', '/v1/experiments', {
      program_id: program,
      assay_type: 'proteomics_dia',
      name: 'should not exist',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'insufficient_scope' });
  });

  it('MCP-02: an IdP token without a tributary scope is refused', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer no-scope',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it('API-02: webhook destinations on private, loopback, link-local or ULA addresses are refused', () => {
    for (const ip of [
      '10.0.0.5',
      '127.0.0.1',
      '169.254.169.254',
      '172.20.1.1',
      '192.168.1.1',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700:4700::1111'])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
