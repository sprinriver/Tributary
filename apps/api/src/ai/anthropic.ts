import type { ModelProvider, ModelRequest, ModelTurn } from './provider.ts';

/** The subset of a Messages API response the adapter reads. */
export interface MessagesResponse {
  stop_reason: string | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string } | null;
  content: ({ type: string } & Record<string, unknown>)[];
  usage: { input_tokens: number; output_tokens: number };
}

/** `client.messages.create` of @anthropic-ai/sdk (or the Bedrock client), injected so this file has no SDK import. */
export type MessagesCreate = (body: Record<string, unknown>) => Promise<MessagesResponse>;

export interface AnthropicOptions {
  model: string;
  create: MessagesCreate;
  maxTokens?: number;
  /**
   * Server-side refusal fallback (`fallbacks: "default"`). Beta: the client must send the
   * `server-side-fallback-2026-07-01` header; not available on Bedrock, so off unless the caller enables it.
   */
  fallbacks?: boolean;
  /** Recorded in provenance. */
  name?: 'anthropic' | 'bedrock';
}

/** Messages API adapter (Claude API or Amazon Bedrock), with adaptive thinking and automatic tool choice. */
export function anthropicProvider(options: AnthropicOptions): ModelProvider {
  return {
    name: options.name ?? 'anthropic',
    model: options.model,
    async complete(request: ModelRequest): Promise<ModelTurn> {
      const res = await options.create({
        model: options.model,
        max_tokens: options.maxTokens ?? 16_000,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
        tool_choice: { type: 'auto' },
        thinking: { type: 'adaptive' },
        ...(options.fallbacks ? { fallbacks: 'default' } : {}),
      });
      // Branch on stop_reason before reading content: a refusal may come with no content at all.
      const refused = res.stop_reason === 'refusal';
      const text = refused
        ? ''
        : res.content
            .filter((b) => b.type === 'text')
            .map((b) => String(b.text))
            .join('\n');
      const tool_calls = refused
        ? []
        : res.content
            .filter((b) => b.type === 'tool_use')
            .map((b) => ({ id: String(b.id), name: String(b.name), input: b.input }));
      const turn: ModelTurn = {
        text,
        tool_calls,
        stop: res.stop_reason ?? 'end_turn',
        usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
        ...(refused
          ? {
              refusal: {
                category: res.stop_details?.category ?? null,
                ...(res.stop_details?.explanation ? { explanation: res.stop_details.explanation } : {}),
              },
            }
          : {}),
      };
      // Replayed verbatim on the next request of the tool loop (thinking blocks included).
      Object.defineProperty(turn, 'content', { value: res.content, enumerable: false });
      return turn;
    },
  };
}
