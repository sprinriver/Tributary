import {
  AiConversationSchema,
  AiDecisionBodySchema,
  AiSettingsSchema,
  AiToolCallSchema,
  CurationSuggestBodySchema,
  CurationSuggestResponseSchema,
  type AiToolCall,
  AiTurnSchema,
  CreateAiConversationBodySchema,
  PostAiMessageBodySchema,
  PutAiSettingsBodySchema,
  type AiMessage,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest, InjectOptions } from 'fastify';
import { sql } from 'kysely';
import { getSetting, putSetting } from '../admin/settings.ts';
import { auditCall, runApproved, runTurn } from '../ai/assistant.ts';
import { suggestTerms } from '../ai/curation.ts';
import type { ModelMessage, ModelProvider } from '../ai/provider.ts';
import { aiSettings } from '../ai/settings.ts';
import { ToolError, type ToolContext } from '../ai/tools.ts';
import { insertAudit, requestActor } from '../audit.ts';
import { requirePrincipal, requireSystemAdmin } from '../auth/plugin.ts';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound, parse } from '../errors.ts';
import { respond } from '../respond.ts';

interface Deps {
  /** The root app: tools call the API through it, in-process, with the caller's credentials. */
  root: FastifyInstance;
  db: Database;
  config: ApiConfig;
  provider: ModelProvider | null;
}

type IdParams = FastifyRequest<{ Params: { id: string } }>;
type CallParams = FastifyRequest<{ Params: { id: string; callId: string } }>;

/** Credentials of the original request, so every tool call is authorised exactly as the user (SPEC §11.2). */
function toolContext(root: FastifyInstance, request: FastifyRequest): ToolContext {
  const headers: Record<string, string> = {};
  for (const h of ['authorization', 'cookie', 'x-csrf-token'] as const) {
    const v = request.headers[h];
    if (typeof v === 'string') headers[h] = v;
  }
  return {
    async call(method, url, payload, extra) {
      const options: InjectOptions = {
        method,
        url,
        headers: extra?.reason ? { ...headers, 'x-change-reason': extra.reason } : headers,
      };
      if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions['payload']>;
      const res = await root.inject(options);
      const body = res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null;
      // The assistant does not tell apart "missing" from "not yours": both read as not found to the model.
      if (res.statusCode === 404 || (res.statusCode === 403 && method === 'GET'))
        throw new ToolError('Not found, or not in a program you can read.');
      if (res.statusCode >= 400)
        throw new ToolError(String(body?.message ?? `The API answered ${res.statusCode}.`));
      return body;
    },
  };
}

function messageRow(m: {
  id: string;
  role: string;
  text: string;
  tool_calls: unknown;
  provenance: unknown;
  refusal: unknown;
  created_at: Date;
}): AiMessage {
  return {
    id: m.id,
    role: m.role as AiMessage['role'],
    text: m.text,
    // Calls stored before ids existed get a stable one from their position.
    tool_calls: (m.tool_calls as AiMessage['tool_calls']).map((c, i) => ({
      ...c,
      id: c.id ?? `${m.id}:${i}`,
    })),
    provenance: (m.provenance ?? null) as AiMessage['provenance'],
    refusal: (m.refusal ?? null) as AiMessage['refusal'],
    created_at: m.created_at.toISOString(),
  };
}

/** AI assistant (SPEC M12, §11): settings, conversations and turns. */
export function registerAiRoutes(app: FastifyInstance, { root, db, config, provider }: Deps): void {
  const settings = (tenantId: string) => aiSettings(db, tenantId, config.ai);

  const ownConversation = async (request: FastifyRequest, id: string) => {
    const principal = requirePrincipal(request);
    const row = await db
      .selectFrom('ai_conversation')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', principal.tenantId)
      .where('user_id', '=', principal.userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw notFound('Conversation');
    return row;
  };
  const messagesOf = (conversationId: string) =>
    db
      .selectFrom('ai_message')
      .select(['id', 'role', 'text', 'tool_calls', 'provenance', 'refusal', 'created_at'])
      .where('conversation_id', '=', conversationId)
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .execute();

  app.get('/v1/ai/settings', async (request) => {
    const principal = requirePrincipal(request);
    return respond(AiSettingsSchema, await settings(principal.tenantId));
  });

  app.put('/v1/admin/ai-settings', async (request) => {
    const principal = requireSystemAdmin(request);
    const body = parse(PutAiSettingsBodySchema, request.body);
    const before = await getSetting(db, principal.tenantId, 'ai');
    await db.transaction().execute(async (trx) => {
      await putSetting(trx, principal.tenantId, principal.userId, 'ai', body);
      await insertAudit(trx, requestActor(request), {
        action: 'ai.settings',
        entityType: 'app_setting',
        entityId: principal.tenantId,
        before: before ?? null,
        after: body,
      });
    });
    return respond(AiSettingsSchema, await settings(principal.tenantId));
  });

  app.post('/v1/ai/conversations', async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = parse(CreateAiConversationBodySchema, request.body ?? {});
    if (!provider || !(await settings(principal.tenantId)).enabled)
      throw new HttpError(409, 'ai_disabled', 'The assistant is not switched on in this deployment.');
    const row = await db
      .insertInto('ai_conversation')
      .values({
        tenant_id: principal.tenantId,
        created_by: principal.userId,
        user_id: principal.userId,
        title: body.title ?? '',
      })
      .returning(['id', 'title', 'created_at'])
      .executeTakeFirstOrThrow();
    reply.code(201);
    return respond(AiConversationSchema, { ...row, created_at: row.created_at.toISOString(), messages: [] });
  });

  app.get('/v1/ai/conversations/:id', async (request: IdParams) => {
    const row = await ownConversation(request, request.params.id);
    return respond(AiConversationSchema, {
      id: row.id,
      title: row.title,
      created_at: row.created_at.toISOString(),
      messages: (await messagesOf(row.id)).map(messageRow),
    });
  });

  app.post('/v1/ai/conversations/:id/messages', async (request: IdParams) => {
    const principal = requirePrincipal(request);
    const conversation = await ownConversation(request, request.params.id);
    const { text } = parse(PostAiMessageBodySchema, request.body);
    const current = await settings(principal.tenantId);
    if (!provider || !current.enabled)
      throw new HttpError(409, 'ai_disabled', 'The assistant is not switched on in this deployment.');
    if (current.tokens_used_this_month >= current.monthly_token_budget)
      throw new HttpError(
        429,
        'ai_budget_exhausted',
        'The assistant has used this month’s token budget. An administrator can raise it.',
      );
    // Earlier turns as plain text (tool details stay in the stored messages and provenance).
    const history: ModelMessage[] = (await messagesOf(conversation.id))
      .filter((m) => m.text)
      .map((m) => ({ role: m.role as ModelMessage['role'], content: m.text }));
    if (!conversation.title)
      await db
        .updateTable('ai_conversation')
        .set({ title: text.slice(0, 200) })
        .where('id', '=', conversation.id)
        .execute();
    await db
      .insertInto('ai_message')
      .values({
        tenant_id: principal.tenantId,
        created_by: principal.userId,
        conversation_id: conversation.id,
        role: 'user',
        text,
      })
      .execute();
    const answer = await runTurn({
      db,
      provider,
      actor: requestActor(request),
      conversationId: conversation.id,
      history,
      text,
      ctx: toolContext(root, request),
      writeToolsEnabled: current.write_tools_enabled,
      tokenBudgetLeft: current.monthly_token_budget - current.tokens_used_this_month,
    });
    const row = await db
      .insertInto('ai_message')
      .values({
        tenant_id: principal.tenantId,
        created_by: principal.userId,
        conversation_id: conversation.id,
        role: 'assistant',
        text: answer.text,
        tool_calls: JSON.stringify(answer.tool_calls),
        provenance: JSON.stringify(answer.provenance),
        refusal: answer.refusal ? JSON.stringify(answer.refusal) : null,
        input_tokens: answer.usage.input_tokens,
        output_tokens: answer.usage.output_tokens,
      })
      .returning(['id', 'role', 'text', 'tool_calls', 'provenance', 'refusal', 'created_at'])
      .executeTakeFirstOrThrow();
    return respond(AiTurnSchema, messageRow(row));
  });

  // SPEC §11.4: a write the assistant proposed runs only when its owner approves it, and only once.
  app.post('/v1/ai/conversations/:id/tool-calls/:callId/decision', async (request: CallParams) => {
    const conversation = await ownConversation(request, request.params.id);
    const { approve } = parse(AiDecisionBodySchema, request.body);
    const callId = request.params.callId;
    // Pending proposals cannot be approved once the assistant or its write tools are switched off.
    const current = await settings(conversation.tenant_id);
    if (approve && (!provider || !current.enabled || !current.write_tools_enabled))
      throw new HttpError(
        409,
        'ai_writes_disabled',
        'Write tools are switched off; this proposal can only be rejected.',
      );
    const locate = async (trx: Database) => {
      const message = await trx
        .selectFrom('ai_message')
        .select(['id', 'tool_calls'])
        .where('conversation_id', '=', conversation.id)
        .where('role', '=', 'assistant')
        .where(sql<boolean>`tool_calls @> ${JSON.stringify([{ id: callId }])}::jsonb`)
        .forUpdate()
        .executeTakeFirst();
      const calls = (message?.tool_calls ?? []) as AiToolCall[];
      const call = calls.find((c) => c.id === callId);
      if (!message || !call) throw notFound('Tool call');
      return { message, calls, call };
    };
    const store = (trx: Database, messageId: string, calls: AiToolCall[], next: AiToolCall) =>
      trx
        .updateTable('ai_message')
        .set({ tool_calls: JSON.stringify(calls.map((c) => (c.id === callId ? next : c))) })
        .where('id', '=', messageId)
        .execute();
    // 1. Claim the proposal and commit, so it can never run twice (even if step 3 fails).
    const claimed = await db.transaction().execute(async (trx) => {
      const { message, calls, call } = await locate(trx);
      if (call.status !== 'pending_approval')
        throw new HttpError(
          409,
          'already_decided',
          `This proposal was already ${call.status === 'rejected' ? 'rejected' : 'decided'}.`,
        );
      const next: AiToolCall = approve
        ? { ...call, status: 'error', error: 'Approved; running…' }
        : { ...call, status: 'rejected' };
      await store(trx, message.id, calls, next);
      await insertAudit(trx, requestActor(request), {
        action: approve ? 'ai.approve' : 'ai.reject',
        entityType: 'ai_conversation',
        entityId: conversation.id,
        before: { call_id: callId, tool: call.tool, status: call.status },
        after: { call_id: callId, tool: call.tool, status: approve ? 'approved' : 'rejected' },
      });
      return { call, next };
    });
    if (!approve) return respond(AiToolCallSchema, claimed.next);
    // 2. Run the write as the user. 3. Record its outcome.
    const result = await runApproved(toolContext(root, request), claimed.call, conversation.id);
    const decided = await db.transaction().execute(async (trx) => {
      const { message, calls } = await locate(trx);
      await store(trx, message.id, calls, result);
      await auditCall(trx, requestActor(request), conversation.id, result);
      return result;
    });
    return respond(AiToolCallSchema, decided);
  });

  // SPEC §11.5: curation suggestions from ontology lookups only (run as the user; no model involved).
  app.post('/v1/ai/curation/suggest', async (request) => {
    requirePrincipal(request);
    const body = parse(CurationSuggestBodySchema, request.body);
    return respond(
      CurationSuggestResponseSchema,
      await suggestTerms(toolContext(root, request), body.ontology, body.values),
    );
  });
}
