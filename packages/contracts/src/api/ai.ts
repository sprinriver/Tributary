import { z } from 'zod';

/** AI assistant (SPEC M12, §11). Providers are chosen in the deployment; `none` (the default) means no assistant. */
export const AI_PROVIDERS = ['none', 'stub', 'anthropic', 'bedrock'] as const;
export const AiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const AI_TOOL_RISKS = ['read', 'compute', 'write'] as const;

export const AiSettingsSchema = z
  .object({
    /** Provider configured and the assistant switched on by an admin. */
    enabled: z.boolean(),
    provider: AiProviderSchema,
    model: z.string().nullable(),
    assistant_enabled: z.boolean(),
    write_tools_enabled: z.boolean(),
    monthly_token_budget: z.int(),
    tokens_used_this_month: z.int(),
    tools: z.array(z.object({ name: z.string(), risk: z.enum(AI_TOOL_RISKS), description: z.string() })),
  })
  .meta({ id: 'AiSettings' });
export type AiSettings = z.infer<typeof AiSettingsSchema>;

export const PutAiSettingsBodySchema = z
  .strictObject({
    assistant_enabled: z.boolean(),
    write_tools_enabled: z.boolean(),
    monthly_token_budget: z.int().min(0).max(10_000_000_000),
  })
  .meta({ id: 'PutAiSettingsBody' });
export type PutAiSettingsBody = z.infer<typeof PutAiSettingsBodySchema>;

export const AiToolCallSchema = z
  .object({
    tool: z.string(),
    status: z.enum(['ok', 'error']),
    input: z.unknown(),
    output: z.unknown(),
    error: z.string().nullable(),
  })
  .meta({ id: 'AiToolCall' });
export type AiToolCall = z.infer<typeof AiToolCallSchema>;

/** What produced an assistant answer (SPEC §11.6). */
export const AiProvenanceSchema = z
  .object({
    provider: AiProviderSchema,
    model: z.string(),
    prompt_version: z.string(),
    tools: z.array(z.string()),
    query_specs: z.array(z.unknown()),
    release_ids: z.array(z.string()),
    input_tokens: z.int(),
    output_tokens: z.int(),
  })
  .meta({ id: 'AiProvenance' });
export type AiProvenance = z.infer<typeof AiProvenanceSchema>;

export const AiMessageSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(['user', 'assistant']),
    text: z.string(),
    tool_calls: z.array(AiToolCallSchema),
    provenance: AiProvenanceSchema.nullable(),
    /** Set when the model declined (SPEC §11.7); the text then explains it to the user. */
    refusal: z.object({ category: z.string().nullable() }).nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'AiMessage' });
export type AiMessage = z.infer<typeof AiMessageSchema>;

export const AiConversationSchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    created_at: z.iso.datetime({ offset: true }),
    messages: z.array(AiMessageSchema),
  })
  .meta({ id: 'AiConversation' });
export type AiConversation = z.infer<typeof AiConversationSchema>;

export const CreateAiConversationBodySchema = z
  .strictObject({ title: z.string().trim().max(200).optional() })
  .meta({ id: 'CreateAiConversationBody' });

export const PostAiMessageBodySchema = z
  .strictObject({ text: z.string().trim().min(1, 'Ask a question.').max(4000) })
  .meta({ id: 'PostAiMessageBody' });

/** One assistant turn: the answer and every tool call it made, in order. */
export const AiTurnSchema = AiMessageSchema.meta({ id: 'AiTurn' });
export type AiTurn = z.infer<typeof AiTurnSchema>;
