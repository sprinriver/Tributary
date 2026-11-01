import type { AiProvider } from '@tributary/contracts';
import { stubProvider } from './stub.ts';

/** Deployment AI settings (SPEC §11.1): the provider is chosen in the deployment, never in the browser. */
export interface AiConfig {
  provider: AiProvider;
  model: string;
  /** Default monthly token budget for the deployment; admins can lower or raise it. */
  monthlyTokenBudget: number;
  /** Region for Amazon Bedrock. */
  bedrockRegion?: string;
}

/** A JSON-Schema tool definition as the model sees it. */
export interface ModelTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ModelBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface ModelMessage {
  role: 'user' | 'assistant';
  /** Provider-native content for assistant turns is replayed verbatim (thinking blocks must be preserved). */
  content: string | ModelBlock[] | unknown[];
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools: ModelTool[];
}

export interface ModelTurn {
  text: string;
  tool_calls: { id: string; name: string; input: unknown }[];
  stop: string;
  usage: { input_tokens: number; output_tokens: number };
  /** The model declined (SPEC §11.7); `category` is informational and may be null. */
  refusal?: { category: string | null; explanation?: string };
}

export interface ModelProvider {
  name: AiProvider;
  model: string;
  complete(request: ModelRequest): Promise<ModelTurn>;
}

/**
 * The provider's own content blocks for a turn, kept off the enumerable shape so callers can replay them on the
 * next request of a tool loop.
 */
export const providerContent = (turn: ModelTurn): unknown[] | undefined =>
  (turn as ModelTurn & { content?: unknown[] }).content;

/** The configured provider, or null when the assistant is off (`none`). */
export function providerFor(config: AiConfig): ModelProvider | null {
  switch (config.provider) {
    case 'none':
      return null;
    case 'stub':
      return stubProvider(config.model);
    case 'anthropic':
    case 'bedrock':
      // The SDK clients are not installed yet (dependency approval pending, docs/PROGRESS.md). Once approved, the
      // client's messages.create is passed to anthropicProvider({ model, create }).
      throw new Error(
        `AI_PROVIDER=${config.provider} needs ${config.provider === 'anthropic' ? '@anthropic-ai/sdk' : '@anthropic-ai/bedrock-sdk (and @anthropic-ai/sdk)'}, which is not installed in this build.`,
      );
  }
}
