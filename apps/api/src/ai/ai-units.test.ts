import { describe, expect, it } from 'vitest';
import { anthropicProvider, type MessagesCreate } from './anthropic.ts';
import { providerFor } from './provider.ts';

describe('AI provider abstraction', () => {
  it('AI-01: none, stub, anthropic and bedrock are the providers; none means no assistant', () => {
    expect(providerFor({ provider: 'none', model: 'x', monthlyTokenBudget: 1 })).toBeNull();
    expect(providerFor({ provider: 'stub', model: 'stub-1', monthlyTokenBudget: 1 })?.name).toBe('stub');
    // Real providers use the approved SDKs (no network call until a turn runs).
    expect(
      providerFor({ provider: 'anthropic', model: 'claude-opus-5-5', monthlyTokenBudget: 1 }),
    ).toMatchObject({ name: 'anthropic', model: 'claude-opus-5-5' });
    // Bedrock model ids depend on the account and region, so AI_MODEL must be set explicitly.
    expect(() =>
      providerFor({
        provider: 'bedrock',
        model: 'claude-opus-5-5',
        monthlyTokenBudget: 1,
        bedrockModelSet: false,
      }),
    ).toThrow(/AI_MODEL/);
    expect(
      providerFor({
        provider: 'bedrock',
        model: 'my-bedrock-model-id',
        monthlyTokenBudget: 1,
        bedrockModelSet: true,
        bedrockRegion: 'eu-west-1',
      }),
    ).toMatchObject({ name: 'bedrock', model: 'my-bedrock-model-id' });
  });

  it('AI-01: the Anthropic adapter maps tools, tool_use blocks, usage and refusals', async () => {
    const sent: Record<string, unknown>[] = [];
    const create: MessagesCreate = async (body) => {
      sent.push(body);
      return {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Searching.' },
          { type: 'tool_use', id: 'tu_1', name: 'search_experiments', input: { query: 'HEK293' } },
        ],
        usage: { input_tokens: 120, output_tokens: 30 },
      };
    };
    const provider = anthropicProvider({ model: 'claude-opus-5-5', create });
    const turn = await provider.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'Find HEK293' }],
      tools: [
        { name: 'search_experiments', description: 'd', input_schema: { type: 'object', properties: {} } },
      ],
    });
    expect(turn).toEqual({
      text: 'Searching.',
      tool_calls: [{ id: 'tu_1', name: 'search_experiments', input: { query: 'HEK293' } }],
      stop: 'tool_use',
      usage: { input_tokens: 120, output_tokens: 30 },
    });
    expect(sent[0]).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'sys',
      tool_choice: { type: 'auto' },
      thinking: { type: 'adaptive' },
    });

    const refusing = anthropicProvider({
      model: 'claude-opus-5-5',
      create: async () => ({
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'bio', explanation: 'declined' },
        content: [],
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    });
    const refused = await refusing.complete({
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
    });
    expect(refused).toMatchObject({ stop: 'refusal', tool_calls: [], refusal: { category: 'bio' } });
  });
});

describe('AI audit redaction (SPEC §11.9)', () => {
  it('AI-02: tool input in the audit log keeps ids and replaces free text by its length', async () => {
    const { redact } = await import('./assistant.ts');
    expect(
      redact({
        query: 'HEK293 knockout',
        version_id: '01a19699-12dc-7b76-b036-1569132f7088',
        changes: [{ from: 'mcf7 cells', term_id: 'cellosaurus:CVCL_0031' }],
        limit: 5,
      }),
    ).toEqual({
      query: '<text 15>',
      version_id: '01a19699-12dc-7b76-b036-1569132f7088',
      changes: [{ from: '<text 10>', term_id: 'cellosaurus:CVCL_0031' }],
      limit: 5,
    });
  });
});
