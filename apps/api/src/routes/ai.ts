import {
  AiConversationSchema,
  AiSettingsSchema,
  AiTurnSchema,
  CreateAiConversationBodySchema,
  PostAiMessageBodySchema,
  PutAiSettingsBodySchema,
  type AiMessage,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyInstance, FastifyRequest, InjectOptions } from 'fastify';
import { getSetting, putSetting } from '../admin/settings.ts';
import { runTurn } from '../ai/assistant.ts';
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

/** Credentials of the original request, so every tool call is authorised exactly as the user (SPEC §11.2). */
function toolContext(root: FastifyInstance, request: FastifyRequest): ToolContext {
  const headers: Record<string, string> = {};
  for (const h of ['authorization', 'cookie', 'x-csrf-token'] as const) {
    const v = request.headers[h];
    if (typeof v === 'string') headers[h] = v;
  }
  return {
    async call(method, url, payload) {
      const options: InjectOptions = { method, url, headers };
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
    tool_calls: m.tool_calls as AiMessage['tool_calls'],
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
}
