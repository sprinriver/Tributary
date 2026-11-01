import { seedDatabase } from '@tributary/db';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');
const RESOURCE = 'http://localhost:5173/api/mcp';

/** SPEC M12 / ARCHITECTURE §11: the MCP server exposes the assistant's tool registry with the caller's permissions. */
describe('MCP server (SPEC M12)', () => {
  let t: TestApi;
  let both: string;
  let oncViewer: string;
  let readOnly: string;
  let bothSub: string;

  /** One JSON-RPC call over Streamable HTTP (stateless, JSON responses). */
  const rpc = async (authorization: string | undefined, method: string, params: Json = {}) => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization ? { authorization } : {}),
      },
      payload: { jsonrpc: '2.0', id: 1, method, params },
    });
    return { res, body: res.body ? (JSON.parse(res.body) as Json) : null };
  };
  const callTool = async (token: string, name: string, args: Json) => {
    const { body } = await rpc(`Bearer ${token}`, 'tools/call', { name, arguments: args });
    const text = body!.result.content[0].text as string;
    return { result: body!.result as Json, json: JSON.parse(text) as Json };
  };

  beforeAll(async () => {
    t = await startTestApi({
      config: { ai: { provider: 'stub', model: 'stub-1', monthlyTokenBudget: 1_000_000 } },
      // The IdP's token introspection (RFC 7662): only "good" tokens for this resource are active.
      introspect: async (token) =>
        token === 'idp-good'
          ? { active: true, sub: bothSub, aud: [RESOURCE], scope: 'openid tributary:read' }
          : token === 'idp-other-audience'
            ? { active: true, sub: bothSub, aud: ['https://elsewhere.example'] }
            : { active: false },
    });
    await seedDatabase(t.db, { fixturesDir: FIXTURES });
    const programs = await t.db.selectFrom('program').select(['id', 'code']).execute();
    const id = (code: string) => programs.find((p) => p.code === code)!.id;
    const bothUser = await t.user('mcp-both', { [id('ONC')]: 'viewer', [id('IMM')]: 'viewer' });
    both = bothUser.token;
    bothSub = (
      await t.db.selectFrom('app_user').select('sub').where('id', '=', bothUser.id).executeTakeFirstOrThrow()
    ).sub;
    oncViewer = (await t.user('mcp-onc', { [id('ONC')]: 'viewer' })).token;
    const ro = await t.user('mcp-ro', { [id('ONC')]: 'viewer' });
    readOnly = (
      await t.call(ro.token, {
        method: 'POST',
        url: '/v1/auth/tokens',
        payload: { name: 'mcp read', scopes: ['read'], expires_in_days: 7 },
      })
    ).json().token;
  });
  afterAll(() => t?.close());

  it('MCP-01: lists the registry tools; read tools are read-only, write tools require user interaction', async () => {
    const { res, body } = await rpc(`Bearer ${both}`, 'tools/list');
    expect(res.statusCode, res.body).toBe(200);
    const tools = body!.result.tools as Json[];
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['search_experiments', 'get_experiment', 'build_query', 'run_query']),
    );
    const search = tools.find((tool) => tool.name === 'search_experiments')!;
    expect(search.inputSchema).toMatchObject({ type: 'object', properties: { query: expect.any(Object) } });
    expect(search.annotations).toMatchObject({ readOnlyHint: true });
    const write = tools.find((tool) => tool.name === 'create_saved_view')!;
    expect(write.annotations).toMatchObject({ readOnlyHint: false });
    expect(write._meta).toMatchObject({ 'tributary/requiresUserInteraction': true });
  });

  it('MCP-01: search_experiments returns different results for two users (their own permissions)', async () => {
    const mine = await callTool(both, 'search_experiments', { query: 'HEK293' });
    const theirs = await callTool(oncViewer, 'search_experiments', { query: 'HEK293' });
    expect(JSON.stringify(mine.json)).toContain('IMM-DIA-04');
    expect(JSON.stringify(theirs.json)).not.toContain('IMM-');
    // Every MCP tool call is audited as acting for the user.
    const audit = await t.db
      .selectFrom('audit_log')
      .select(['actor_type', 'after'])
      .where('action', '=', 'mcp.tool_call')
      .execute();
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit[0]).toMatchObject({ actor_type: 'ai_assistant_on_behalf_of' });
  });

  it('MCP-01: a tool error comes back as an MCP tool error, not data', async () => {
    const { body } = await rpc(`Bearer ${oncViewer}`, 'tools/call', {
      name: 'get_experiment',
      arguments: { id: '01a19699-12dc-7b76-b036-1569132f7088' },
    });
    expect(body!.result.isError).toBe(true);
    expect(body!.result.content[0].text).toMatch(/not found/i);
  });

  it('MCP-02: protected resource metadata names the IdP; anonymous calls get a 401 pointing to it', async () => {
    const meta = await t.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [expect.stringContaining('/realms/tributary')],
      bearer_methods_supported: ['header'],
    });
    const anonymous = await rpc(undefined, 'tools/list');
    expect(anonymous.res.statusCode).toBe(401);
    expect(anonymous.res.headers['www-authenticate']).toMatch(
      /resource_metadata=".*oauth-protected-resource/,
    );
  });

  it('MCP-02: IdP access tokens must be active and issued for this resource (audience); PATs still work', async () => {
    const good = await rpc('Bearer idp-good', 'tools/call', {
      name: 'search_experiments',
      arguments: { query: 'HEK293' },
    });
    expect(good.res.statusCode, good.res.body).toBe(200);
    expect(good.body!.result.content[0].text).toContain('IMM-DIA-04');
    expect((await rpc('Bearer idp-other-audience', 'tools/list')).res.statusCode).toBe(401);
    expect((await rpc('Bearer idp-expired', 'tools/list')).res.statusCode).toBe(401);
    // A read-only PAT can use read tools over MCP (MCP is always POST).
    const ro = await rpc(`Bearer ${readOnly}`, 'tools/call', {
      name: 'search_experiments',
      arguments: { query: 'HeLa' },
    });
    expect(ro.res.statusCode, ro.res.body).toBe(200);
    expect(ro.body!.result.isError).toBeFalsy();
  });

  it('MCP-02: write tools need a write-scoped token and an admin who allows them', async () => {
    const spec = { source: { kind: 'sample', scope: {} } };
    const denied = await rpc(`Bearer ${readOnly}`, 'tools/call', {
      name: 'create_saved_view',
      arguments: { name: 'via MCP', query_spec: spec },
    });
    expect(denied.body!.result.isError).toBe(true);
    expect(denied.body!.result.content[0].text).toMatch(/read-only|switched off/i);
  });
});
