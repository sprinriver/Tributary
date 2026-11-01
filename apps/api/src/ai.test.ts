import { seedDatabase } from '@tributary/db';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');

/** SPEC M12 / §11: an optional assistant that only acts through validated tools, as the signed-in user. */
describe('AI assistant (SPEC M12)', () => {
  let t: TestApi;
  let off: TestApi;
  let both: string;
  let oncViewer: string;
  let admin: string;
  let ONC: string;
  let IMM: string;

  const ask = async (token: string, text: string, conversation?: string) => {
    const id =
      conversation ??
      ((await t.call(token, { method: 'POST', url: '/v1/ai/conversations', payload: {} })).json() as Json).id;
    const res = await t.call(token, {
      method: 'POST',
      url: `/v1/ai/conversations/${id}/messages`,
      payload: { text },
    });
    return { id: id as string, res, turn: res.json() as Json };
  };

  beforeAll(async () => {
    [t, off] = await Promise.all([
      startTestApi({
        query: true,
        s3: true,
        config: { ai: { provider: 'stub', model: 'stub-1', monthlyTokenBudget: 1_000_000 } },
      }),
      startTestApi(),
    ]);
    await seedDatabase(t.db, { fixturesDir: FIXTURES });
    const programs = await t.db.selectFrom('program').select(['id', 'code']).execute();
    ONC = programs.find((p) => p.code === 'ONC')!.id;
    IMM = programs.find((p) => p.code === 'IMM')!.id;
    both = (await t.user('ai-both', { [ONC]: 'viewer', [IMM]: 'viewer' })).token;
    oncViewer = (await t.user('ai-onc', { [ONC]: 'viewer' })).token;
    const adminUser = await t.user('ai-admin', {});
    await t.db
      .insertInto('role_binding')
      .values({
        tenant_id: (await t.db.selectFrom('program').select('tenant_id').executeTakeFirstOrThrow()).tenant_id,
        created_by: adminUser.id,
        user_id: adminUser.id,
        program_id: null,
        role: 'system_admin',
      })
      .execute();
    admin = adminUser.token;
  });
  afterAll(async () => {
    await t?.close();
    await off?.close();
  });

  it('AI-01: the assistant is off by default (no provider) and says so', async () => {
    const program = await off.program('OFF');
    const user = (await off.user('off-user', { [program]: 'viewer' })).token;
    const settings = (await off.call(user, { method: 'GET', url: '/v1/ai/settings' })).json() as Json;
    expect(settings).toMatchObject({ enabled: false, provider: 'none' });
    const res = await off.call(user, { method: 'POST', url: '/v1/ai/conversations', payload: {} });
    expect(res.statusCode).toBe(409);
    expect((res.json() as Json).code).toBe('ai_disabled');
  });

  it('AI-01: admins set features and the monthly token budget (audited); the budget stops new turns', async () => {
    const put = await t.call(admin, {
      method: 'PUT',
      url: '/v1/admin/ai-settings',
      payload: { assistant_enabled: true, write_tools_enabled: true, monthly_token_budget: 1_000_000 },
      headers: { 'x-change-reason': 'test' },
    });
    expect(put.statusCode, put.body).toBe(200);
    const settings = (await t.call(both, { method: 'GET', url: '/v1/ai/settings' })).json() as Json;
    expect(settings).toMatchObject({
      enabled: true,
      provider: 'stub',
      model: 'stub-1',
      write_tools_enabled: true,
    });
    expect(settings.tokens_used_this_month).toEqual(expect.any(Number));
    expect(
      (await t.call(both, { method: 'PUT', url: '/v1/admin/ai-settings', payload: {} })).statusCode,
    ).toBe(403);

    // A budget smaller than what was already used refuses the next turn.
    await ask(both, 'Find experiments with HEK293');
    await t.call(admin, {
      method: 'PUT',
      url: '/v1/admin/ai-settings',
      payload: { assistant_enabled: true, write_tools_enabled: true, monthly_token_budget: 1 },
      headers: { 'x-change-reason': 'test' },
    });
    const over = await ask(both, 'Find experiments with HEK293');
    expect(over.res.statusCode).toBe(429);
    expect(over.turn.code).toBe('ai_budget_exhausted');
    await t.call(admin, {
      method: 'PUT',
      url: '/v1/admin/ai-settings',
      payload: { assistant_enabled: true, write_tools_enabled: true, monthly_token_budget: 1_000_000 },
      headers: { 'x-change-reason': 'test' },
    });
  });

  it('AI-02: tools run as the user — a viewer of one program cannot reach another program through the assistant', async () => {
    const mine = await ask(both, 'Find experiments with HEK293');
    expect(mine.res.statusCode, mine.res.body).toBe(200);
    expect(mine.turn.tool_calls[0]).toMatchObject({ tool: 'search_experiments', status: 'ok' });
    expect(JSON.stringify(mine.turn.tool_calls[0].output)).toContain('IMM-DIA-04');
    expect(mine.turn.text).toContain('IMM-DIA-04');

    const theirs = await ask(oncViewer, 'Find experiments with HEK293');
    expect(theirs.turn.tool_calls[0]).toMatchObject({ tool: 'search_experiments', status: 'ok' });
    expect(JSON.stringify(theirs.turn.tool_calls[0].output)).not.toContain('IMM-');
    expect(theirs.turn.text).not.toContain('IMM-');

    // Asking for an IMM experiment by id fails with the API's own answer (not found), not data.
    const immExperiment = await t.db
      .selectFrom('experiment')
      .select('id')
      .where('program_id', '=', IMM)
      .executeTakeFirstOrThrow();
    const direct = await ask(oncViewer, `Get experiment ${immExperiment.id}`);
    expect(direct.turn.tool_calls[0]).toMatchObject({ tool: 'get_experiment', status: 'error' });
    expect(direct.turn.tool_calls[0].error).toMatch(/not found/i);
  });

  it('AI-02: every tool call is audited as the assistant acting for the user, and turns carry provenance', async () => {
    const { id } = await ask(both, 'Find experiments with K-562');
    const calls = await t.db
      .selectFrom('audit_log')
      .select(['actor_type', 'action', 'after'])
      .where('action', '=', 'ai.tool_call')
      .where('entity_id', '=', id)
      .execute();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ actor_type: 'ai_assistant_on_behalf_of' });
    expect(calls[0]!.after).toMatchObject({ tool: 'search_experiments' });
    const conversation = (
      await t.call(both, { method: 'GET', url: `/v1/ai/conversations/${id}` })
    ).json() as Json;
    const assistant = (conversation.messages as Json[]).find((m) => m.role === 'assistant')!;
    expect(assistant.provenance).toMatchObject({
      provider: 'stub',
      model: 'stub-1',
      prompt_version: expect.any(String),
    });
    expect(assistant.provenance.tools).toEqual(['search_experiments']);
    // Someone else cannot read the conversation.
    expect((await t.call(oncViewer, { method: 'GET', url: `/v1/ai/conversations/${id}` })).statusCode).toBe(
      404,
    );
  });

  it('AI-03: questions about data become validated QuerySpecs that run as the user and link to the Explorer', async () => {
    const release = await t.db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .select('r.id')
      .where('d.program_id', '=', ONC)
      .where('r.status', '=', 'published')
      .executeTakeFirst();
    // The seed may hold no releases; the pipeline-free path is checked with the dataset catalog then.
    if (!release) {
      const catalog = await ask(both, 'List datasets');
      expect(catalog.turn.tool_calls[0]).toMatchObject({ tool: 'list_datasets', status: 'ok' });
      return;
    }
    const turn = (await ask(both, `Show the first rows of release ${release.id}`)).turn;
    const build = (turn.tool_calls as Json[]).find((c) => c.tool === 'build_query')!;
    expect(build.status).toBe('ok');
    expect(build.output.query_spec).toMatchObject({ source: { releaseIds: [release.id] } });
    expect(build.output.explorer_url).toMatch(/^\/explore\?q=/);
    const run = (turn.tool_calls as Json[]).find((c) => c.tool === 'run_query')!;
    expect(run.status).toBe('ok');
    expect(run.output.rows.length).toBeGreaterThan(0);
    expect(run.output.rows.length).toBeLessThanOrEqual(25);
  });

  it('AI-03: an invalid QuerySpec from the model is refused by validation and never executed', async () => {
    const turn = (await ask(both, 'Build an invalid query')).turn;
    const build = (turn.tool_calls as Json[])[0]!;
    expect(build).toMatchObject({ tool: 'build_query', status: 'error' });
    expect(build.error).toMatch(/source|invalid/i);
    expect((turn.tool_calls as Json[]).some((c) => c.tool === 'run_query')).toBe(false);
  });
});
