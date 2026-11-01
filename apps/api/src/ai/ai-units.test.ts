import { describe, expect, it } from 'vitest';
import { anthropicProvider, type MessagesCreate } from './anthropic.ts';
import { providerFor } from './provider.ts';

describe('AI provider abstraction', () => {
  it('AI-01: none, stub, anthropic and bedrock are the providers; none means no assistant', () => {
    expect(providerFor({ provider: 'none', model: 'x', monthlyTokenBudget: 1 })).toBeNull();
    expect(providerFor({ provider: 'stub', model: 'stub-1', monthlyTokenBudget: 1 })?.name).toBe('stub');
    // Real providers need their SDK client injected (dependency approval pending) — without it they explain why.
    expect(() =>
      providerFor({ provider: 'anthropic', model: 'claude-opus-5-5', monthlyTokenBudget: 1 }),
    ).toThrow(/@anthropic-ai\/sdk/);
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
