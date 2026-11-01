import {
  AiConversationSchema,
  AiDecisionBodySchema,
  AiToolCallSchema,
  CurationSuggestBodySchema,
  CurationSuggestResponseSchema,
  AiSettingsSchema,
  AiTurnSchema,
  CreateAiConversationBodySchema,
  PostAiMessageBodySchema,
  PutAiSettingsBodySchema,
} from './ai.ts';
import type { ApiRoute } from './route.ts';

/** AI assistant (SPEC M12). Part of API_ROUTES. */
export const AI_ROUTES = {
  getAiSettings: {
    method: 'get',
    path: '/v1/ai/settings',
    summary: 'Whether the assistant is available, its provider, budget use and tools',
    response: AiSettingsSchema,
  },
  putAiSettings: {
    method: 'put',
    path: '/v1/admin/ai-settings',
    summary: 'Switch the assistant and write tools on or off and set the monthly token budget (system admin)',
    body: PutAiSettingsBodySchema,
    response: AiSettingsSchema,
    reason: true,
  },
  createAiConversation: {
    method: 'post',
    path: '/v1/ai/conversations',
    summary: 'Start a conversation with the assistant (409 ai_disabled when it is off)',
    body: CreateAiConversationBodySchema,
    response: AiConversationSchema,
    status: 201,
  },
  getAiConversation: {
    method: 'get',
    path: '/v1/ai/conversations/{id}',
    summary: 'One of your conversations with its messages, tool calls and provenance',
    response: AiConversationSchema,
  },
  postAiMessage: {
    method: 'post',
    path: '/v1/ai/conversations/{id}/messages',
    summary: 'Ask the assistant; it answers through tools run as you (429 ai_budget_exhausted)',
    body: PostAiMessageBodySchema,
    response: AiTurnSchema,
  },
  decideAiToolCall: {
    method: 'post',
    path: '/v1/ai/conversations/{id}/tool-calls/{callId}/decision',
    summary:
      'Approve or reject a write the assistant proposed; an approved write runs as you (409 once decided)',
    body: AiDecisionBodySchema,
    response: AiToolCallSchema,
  },
  suggestCurationTerms: {
    method: 'post',
    path: '/v1/ai/curation/suggest',
    summary: 'Ontology terms for free-text values, from ontology lookups only (no match when none fits)',
    body: CurationSuggestBodySchema,
    response: CurationSuggestResponseSchema,
  },
} as const satisfies Record<string, ApiRoute>;
