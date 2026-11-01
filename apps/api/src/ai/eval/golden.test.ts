import { seedDatabase } from '@tributary/db';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from '../../testing.ts';
import golden from './golden.json' with { type: 'json' };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FIXTURES = resolve(import.meta.dirname, '../../../../../fixtures');

/**
 * Golden questions (SPEC §11.8), scored by result equivalence: the experiments of the last search_experiments call
 * must be exactly the expected ones. CI runs the stub provider; a real provider is run by hand with
 * AI_EVAL_PROVIDER/AI_EVAL_MODEL once its SDK is installed (score recorded in docs/PROGRESS.md).
 */
describe('AI golden-question eval', () => {
  let t: TestApi;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    t = await startTestApi({
      config: { ai: { provider: 'stub', model: 'stub-1', monthlyTokenBudget: 100_000_000 } },
    });
    await seedDatabase(t.db, { fixturesDir: FIXTURES });
    const programs = await t.db.selectFrom('program').select(['id', 'code']).execute();
    const id = (code: string) => programs.find((p) => p.code === code)!.id;
    tokens.both = (await t.user('eval-both', { [id('ONC')]: 'viewer', [id('IMM')]: 'viewer' })).token;
    tokens.onc_viewer = (await t.user('eval-onc', { [id('ONC')]: 'viewer' })).token;
  });
  afterAll(() => t?.close());

  it(`AI-05: ${golden.questions.length} golden questions score 100% with the stub provider`, async () => {
    expect(golden.questions.length).toBeGreaterThanOrEqual(30);
    const failures: string[] = [];
    for (const q of golden.questions) {
      const token = tokens[q.user]!;
      const conv = (
        await t.call(token, { method: 'POST', url: '/v1/ai/conversations', payload: {} })
      ).json() as Json;
      const turn = (
        await t.call(token, {
          method: 'POST',
          url: `/v1/ai/conversations/${conv.id}/messages`,
          payload: { text: q.question },
        })
      ).json() as Json;
      const calls = ((turn.tool_calls ?? []) as Json[]).filter((c) => c.tool === q.tool && c.status === 'ok');
      const last = calls.at(-1);
      const found: string[] = ((last?.output?.experiments ?? []) as Json[]).map((e) =>
        String(e.name).split(':')[0]!.trim(),
      );
      const k = q.expected_experiments.length;
      const top = [...new Set(found.slice(0, Math.max(k, 1)))].sort();
      const ok = !last
        ? false
        : k === 0
          ? found.length === 0 && /no experiments/i.test(String(turn.text))
          : found.length >= k &&
            JSON.stringify(found.slice(0, k).sort()) === JSON.stringify(q.expected_experiments);
      if (!ok) failures.push(`${q.id} "${q.question}": got [${top.join(', ')}] (all: ${found.join(', ')})`);
    }
    const score = (golden.questions.length - failures.length) / golden.questions.length;
    console.log(`AI eval (stub): ${(score * 100).toFixed(0)}% of ${golden.questions.length}`);
    expect(failures).toEqual([]);
  }, 300_000);
});
