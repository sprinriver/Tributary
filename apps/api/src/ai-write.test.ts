import { seedDatabase } from '@tributary/db';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelProvider } from './ai/provider.ts';
import { manifestRows, publishedDaRelease } from './testing-data.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FIXTURES = resolve(import.meta.dirname, '../../../fixtures');

/** Hermetic: OLS4 is unreachable, so ontology lookups use the built-in terms (source "local"). */
const offline: typeof fetch = async () => {
  throw new Error('offline');
};

/** SPEC M12 / §11.4–5: writes need the user's approval; curation suggestions come only from ontology lookups. */
describe('AI assistant writes and curation (SPEC M12)', () => {
  let t: TestApi;
  let contributor: string;
  let other: string;
  let admin: string;
  let ONC: string;
  let release: string;

  const ask = async (token: string, text: string) => {
    const conv = (
      await t.call(token, { method: 'POST', url: '/v1/ai/conversations', payload: {} })
    ).json() as Json;
    const res = await t.call(token, {
      method: 'POST',
      url: `/v1/ai/conversations/${conv.id}/messages`,
      payload: { text },
    });
    return { id: conv.id as string, res, turn: res.json() as Json };
  };
  const decide = (token: string, conversation: string, call: string, approve: boolean) =>
    t.call(token, {
      method: 'POST',
      url: `/v1/ai/conversations/${conversation}/tool-calls/${call}/decision`,
      payload: { approve },
    });
  const setWrites = (enabled: boolean) =>
    t.call(admin, {
      method: 'PUT',
      url: '/v1/admin/ai-settings',
      payload: { assistant_enabled: true, write_tools_enabled: enabled, monthly_token_budget: 10_000_000 },
      headers: { 'x-change-reason': 'test' },
    });
  const views = async (token: string) =>
    ((await t.call(token, { method: 'GET', url: '/v1/views' })).json() as Json).items as Json[];

  beforeAll(async () => {
    t = await startTestApi({
      query: true,
      s3: true,
      fetch: offline,
      config: { ai: { provider: 'stub', model: 'stub-1', monthlyTokenBudget: 10_000_000 } },
    });
    await seedDatabase(t.db, { fixturesDir: FIXTURES });
    ONC = (await t.db.selectFrom('program').select('id').where('code', '=', 'ONC').executeTakeFirstOrThrow())
      .id;
    contributor = (await t.user('aiw-contrib', { [ONC]: 'contributor' })).token;
    other = (await t.user('aiw-other', { [ONC]: 'contributor' })).token;
    const adminUser = await t.user('aiw-admin', {});
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
    release = (await publishedDaRelease(t, contributor, ONC, 'AIW-DA-01')).release;
  });
  afterAll(() => t?.close());

  it('AI-04: write tools are not offered while switched off', async () => {
    expect((await setWrites(false)).statusCode).toBe(200);
    const { turn } = await ask(contributor, `Save a view of release ${release} named Off view`);
    const call = (turn.tool_calls as Json[]).find((c) => c.tool === 'create_saved_view')!;
    expect(call).toMatchObject({ status: 'error' });
    expect(call.error).toMatch(/switched off/i);
    expect((await views(contributor)).some((v) => v.name === 'Off view')).toBe(false);
  });

  it('AI-04: a write tool pauses for approval; approving runs it as the user, rejecting does not', async () => {
    await setWrites(true);
    const asked = await ask(contributor, `Save a view of release ${release} named Assistant view`);
    expect(asked.res.statusCode, asked.res.body).toBe(200);
    const pending = (asked.turn.tool_calls as Json[]).find((c) => c.tool === 'create_saved_view')!;
    expect(pending).toMatchObject({ status: 'pending_approval', id: expect.any(String) });
    expect(asked.turn.text).toMatch(/approve/i);
    // Nothing is written before approval.
    expect((await views(contributor)).some((v) => v.name === 'Assistant view')).toBe(false);

    // Only the conversation's owner can decide.
    expect((await decide(other, asked.id, pending.id, true)).statusCode).toBe(404);

    const approved = await decide(contributor, asked.id, pending.id, true);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ id: pending.id, status: 'ok' });
    const saved = (await views(contributor)).find((v) => v.name === 'Assistant view');
    expect(saved).toBeDefined();
    // The write is the user's own (their permissions), and its audit row says the assistant proposed it.
    const audit = await t.db
      .selectFrom('audit_log')
      .select(['action', 'actor_type', 'reason'])
      .where('entity_id', '=', saved!.id)
      .executeTakeFirstOrThrow();
    expect(audit.actor_type).toBe('user');
    expect(audit.reason).toMatch(/assistant/i);
    // A decided call cannot be decided again.
    expect((await decide(contributor, asked.id, pending.id, true)).statusCode).toBe(409);

    const second = await ask(contributor, `Save a view of release ${release} named Rejected view`);
    const call = (second.turn.tool_calls as Json[]).find((c) => c.tool === 'create_saved_view')!;
    const rejected = await decide(contributor, second.id, call.id, false);
    expect(rejected.json()).toMatchObject({ status: 'rejected' });
    expect((await views(contributor)).some((v) => v.name === 'Rejected view')).toBe(false);
    const conversation = (
      await t.call(contributor, { method: 'GET', url: `/v1/ai/conversations/${second.id}` })
    ).json() as Json;
    const stored = (conversation.messages as Json[]).flatMap((m) => m.tool_calls as Json[]);
    expect(stored.find((c) => c.id === call.id)).toMatchObject({ status: 'rejected' });
  });

  it('AI-04: curation suggestions come only from ontology lookups; unknown values get no match', async () => {
    const res = await t.call(contributor, {
      method: 'POST',
      url: '/v1/ai/curation/suggest',
      payload: { ontology: 'cellosaurus', values: ['hela', 'A549 cells', 'zebrafish fin'] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as Json).items as Json[];
    expect(items.map((i) => [i.value, i.term?.id ?? null])).toEqual([
      ['hela', 'cellosaurus:CVCL_0030'],
      ['A549 cells', 'cellosaurus:CVCL_0023'],
      ['zebrafish fin', null],
    ]);
    expect(items[2]).toMatchObject({ term: null, note: expect.stringMatching(/no match/i) });
  });

  it('AI-04: the assistant fixes free-text manifest values with ontology terms only after approval', async () => {
    const created = (
      await t.call(contributor, {
        method: 'POST',
        url: '/v1/experiments',
        payload: { program_id: ONC, assay_type: 'proteomics_dia', name: 'AIW-CUR-01' },
        headers: { 'x-change-reason': 'test' },
      })
    ).json() as Json;
    const version = created.versions[0].id as string;
    const rows = manifestRows().map((r) => ({ ...r, cell_line: 'mcf7 cells' }));
    await t.call(contributor, {
      method: 'PUT',
      url: `/v1/versions/${version}/samples`,
      payload: { rows },
      headers: { 'x-change-reason': 'test' },
    });
    const cellLines = async () =>
      (
        (await t.call(contributor, { method: 'GET', url: `/v1/versions/${version}/samples` })).json() as Json
      ).items.map((s: Json) => s.raw.cell_line as string);

    const asked = await ask(contributor, `Fix the cell_line terms in version ${version}`);
    const suggest = (asked.turn.tool_calls as Json[]).find((c) => c.tool === 'suggest_ontology_terms')!;
    expect(suggest.status).toBe('ok');
    const apply = (asked.turn.tool_calls as Json[]).find((c) => c.tool === 'apply_metadata_suggestions')!;
    expect(apply.status).toBe('pending_approval');
    expect(new Set(await cellLines())).toEqual(new Set(['mcf7 cells']));

    const approved = await decide(contributor, asked.id, apply.id, true);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(new Set(await cellLines())).toEqual(new Set(['MCF-7']));
  });

  it('AI-04: an apply with a term the lookup did not return is refused', async () => {
    const created = (
      await t.call(contributor, {
        method: 'POST',
        url: '/v1/experiments',
        payload: { program_id: ONC, assay_type: 'proteomics_dia', name: 'AIW-CUR-02' },
        headers: { 'x-change-reason': 'test' },
      })
    ).json() as Json;
    const version = created.versions[0].id as string;
    await t.call(contributor, {
      method: 'PUT',
      url: `/v1/versions/${version}/samples`,
      payload: { rows: manifestRows().map((r) => ({ ...r, cell_line: 'mcf7 cells' })) },
      headers: { 'x-change-reason': 'test' },
    });
    // An invented term: the stub proposes exactly what the model asks for in this phrasing.
    const asked = await ask(
      contributor,
      `Set cell_line "mcf7 cells" to cellosaurus:CVCL_9999 in version ${version}`,
    );
    const apply = (asked.turn.tool_calls as Json[]).find((c) => c.tool === 'apply_metadata_suggestions')!;
    const decided = await decide(contributor, asked.id, apply.id, true);
    expect(decided.json()).toMatchObject({ status: 'error' });
    expect((decided.json() as Json).error).toMatch(/not .*ontology lookup|no match/i);
  });
});

describe('AI refusals (SPEC §11.7)', () => {
  let t: TestApi;
  let user: string;
  const refusing: ModelProvider = {
    name: 'anthropic',
    model: 'claude-opus-5-5',
    complete: async () => ({
      text: '',
      tool_calls: [],
      stop: 'refusal',
      usage: { input_tokens: 12, output_tokens: 0 },
      refusal: { category: 'bio' },
    }),
  };

  beforeAll(async () => {
    t = await startTestApi({
      config: { ai: { provider: 'anthropic', model: 'claude-opus-5-5', monthlyTokenBudget: 1_000_000 } },
      aiProvider: refusing,
    });
    user = (await t.user('refused', { [await t.program('REF')]: 'viewer' })).token;
  });
  afterAll(() => t?.close());

  it('AI-04: a refusal is explained to the user, recorded, and counts its tokens', async () => {
    const conv = (
      await t.call(user, { method: 'POST', url: '/v1/ai/conversations', payload: {} })
    ).json() as Json;
    const res = await t.call(user, {
      method: 'POST',
      url: `/v1/ai/conversations/${conv.id}/messages`,
      payload: { text: 'Design a molecule' },
    });
    expect(res.statusCode).toBe(200);
    const turn = res.json() as Json;
    expect(turn.refusal).toEqual({ category: 'bio' });
    expect(turn.tool_calls).toEqual([]);
    expect(turn.text).toMatch(/declined/i);
    expect(turn.text).toMatch(/your own|experiments|datasets/i);
    const settings = (await t.call(user, { method: 'GET', url: '/v1/ai/settings' })).json() as Json;
    expect(settings.tokens_used_this_month).toBe(12);
  });
});
