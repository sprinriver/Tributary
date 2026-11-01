import type { AiMessage, AiProvenance, AiToolCall } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { insertAudit, type AuditActor } from '../audit.ts';
import {
  providerContent,
  type ModelBlock,
  type ModelMessage,
  type ModelProvider,
  type ModelTurn,
} from './provider.ts';
import { REGISTRY, toolByName } from './registry.ts';
import { modelTools, type ToolContext } from './tools.ts';

/** Bumped whenever SYSTEM_PROMPT changes; recorded in provenance (SPEC §11.6). */
export const PROMPT_VERSION = '2026-11-01.2';

export const SYSTEM_PROMPT = `You help drug-discovery scientists find and understand their own experiment data in this platform.
Use the tools to look things up; never answer from memory about the user's data. Tools run with the user's own
permissions, so if a tool says something is not found, say so plainly: do not guess what it might contain.
Ask for data only through QuerySpecs (build_query, then run_query); never write SQL or code. Show the user which
QuerySpec you ran and cite release ids. Report statistics exactly as the tools return them: log2 fold change is
log2(numerator / denominator) and adjusted p-values are as stored with the release.
Ontology terms must come from suggest_ontology_terms; when it says "no match", say so and never invent a term.
Write tools only propose a change: the user approves or rejects it in the panel, so do not repeat a proposal.
Keep answers short.`;

/** Tool calls one turn may make before the assistant has to answer. */
const MAX_STEPS = 8;

export interface TurnInput {
  db: Database;
  provider: ModelProvider;
  actor: AuditActor;
  conversationId: string;
  history: ModelMessage[];
  text: string;
  ctx: ToolContext;
  writeToolsEnabled: boolean;
  /** Tokens left in this month's budget; the turn stops calling the model once it is spent. */
  tokenBudgetLeft: number;
}

const issues = (error: { issues: { path: PropertyKey[]; message: string }[] }) =>
  error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');

const ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z]+:[A-Za-z0-9_]+)$/i;

/**
 * Tool input for the audit log (SPEC §11.9: no customer data beyond ids): ids and term ids are kept, numbers and
 * booleans too, and any other text is replaced by its length.
 */
export function redact(value: unknown): unknown {
  if (typeof value === 'string') return ID.test(value) ? value : `<text ${value.length}>`;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  return value;
}

/** SPEC §11.9: every tool call is audited as the assistant acting for the user (ids and outcome, no data rows). */
export async function auditCall(db: Database, actor: AuditActor, conversationId: string, call: AiToolCall) {
  await insertAudit(
    db,
    { ...actor, kind: 'ai_assistant_on_behalf_of' },
    {
      action: 'ai.tool_call',
      entityType: 'ai_conversation',
      entityId: conversationId,
      after: {
        call_id: call.id,
        tool: call.tool,
        status: call.status,
        input: redact(call.input),
        error: call.error,
      },
      reason: null,
    },
  );
}

/** Runs a read or compute tool now; a write tool is validated and left pending for the user's approval. */
async function runTool(input: TurnInput, id: string, name: string, args: unknown): Promise<AiToolCall> {
  const tool = toolByName(name);
  const fail = (error: string): AiToolCall => ({
    id,
    tool: name,
    status: 'error',
    input: args,
    output: null,
    error,
  });
  let call: AiToolCall;
  const parsed = tool?.input.safeParse(args);
  if (!tool || !parsed) call = fail(`Unknown tool ${name}.`);
  else if (tool.risk === 'write' && !input.writeToolsEnabled)
    call = fail('Write tools are switched off by your administrator.');
  else if (!parsed.success) call = fail(`Invalid input: ${issues(parsed.error)}`);
  else if (tool.risk === 'write')
    call = { id, tool: name, status: 'pending_approval', input: parsed.data, output: null, error: null };
  else
    try {
      call = {
        id,
        tool: name,
        status: 'ok',
        input: args,
        output: await tool.run(input.ctx, parsed.data as never),
        error: null,
      };
    } catch (error) {
      call = fail(error instanceof Error ? error.message : String(error));
    }
  await auditCall(input.db, input.actor, input.conversationId, call);
  return call;
}

/** What the model is told about a call. */
function resultFor(
  call: AiToolCall,
): Pick<Extract<ModelBlock, { type: 'tool_result' }>, 'content' | 'is_error'> {
  if (call.status === 'ok') return { content: JSON.stringify(call.output) };
  if (call.status === 'pending_approval')
    return {
      content: JSON.stringify({
        status: 'pending_approval',
        message: 'Proposed. The user will approve or reject it in the panel; nothing has changed yet.',
      }),
    };
  return { content: call.error ?? 'error', is_error: true };
}

/** Release ids a turn read, for provenance. */
function releasesOf(calls: AiToolCall[]): string[] {
  const ids = new Set<string>();
  for (const c of calls) {
    const source = (c.input as { query_spec?: { source?: { releaseIds?: string[] } } } | null)?.query_spec
      ?.source;
    for (const id of source?.releaseIds ?? []) ids.add(id);
    if (c.tool === 'describe_release') ids.add((c.input as { id: string }).id);
  }
  return [...ids];
}

/** Runs one user turn: the model calls tools (as the user) until it answers, then the answer is stored. */
export async function runTurn(
  input: TurnInput,
): Promise<
  Omit<AiMessage, 'id' | 'created_at'> & { usage: { input_tokens: number; output_tokens: number } }
> {
  const messages: ModelMessage[] = [...input.history, { role: 'user', content: input.text }];
  const calls: AiToolCall[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  const tools = modelTools(REGISTRY.filter((t) => t.risk !== 'write' || input.writeToolsEnabled));
  let turn: ModelTurn | undefined;
  let budgetStop = false;
  for (let step = 0; step <= MAX_STEPS; step++) {
    turn = await input.provider.complete({ system: SYSTEM_PROMPT, messages, tools });
    usage.input_tokens += turn.usage.input_tokens;
    usage.output_tokens += turn.usage.output_tokens;
    if (turn.refusal || !turn.tool_calls.length || step === MAX_STEPS) break;
    // The budget is re-checked between model calls, so one turn cannot run far past it.
    if (usage.input_tokens + usage.output_tokens >= input.tokenBudgetLeft) {
      budgetStop = true;
      break;
    }
    const content: ModelBlock[] = [
      ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
      ...turn.tool_calls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })),
    ];
    messages.push({ role: 'assistant', content: providerContent(turn) ?? content });
    const results: ModelBlock[] = [];
    for (const c of turn.tool_calls) {
      const call = await runTool(input, crypto.randomUUID(), c.name, c.input);
      calls.push(call);
      results.push({ type: 'tool_result', tool_use_id: c.id, ...resultFor(call) });
    }
    messages.push({ role: 'user', content: results });
  }
  const refusal = turn?.refusal ? { category: turn.refusal.category } : null;
  // SPEC §11.7: a refusal is explained, and the user can rephrase around their own data.
  const text = refusal
    ? 'The model declined to answer this request. I can help you find and explain your own experiments and datasets — try asking about a specific experiment, dataset or release.'
    : budgetStop
      ? 'This month’s token budget ran out during this answer; the tool calls so far are shown.'
      : turn?.text ||
        (calls.length ? 'I ran out of steps before finishing; the tool calls so far are shown.' : '');
  const provenance: AiProvenance = {
    provider: input.provider.name,
    model: input.provider.model,
    prompt_version: PROMPT_VERSION,
    tools: calls.map((c) => c.tool),
    query_specs: calls
      .filter((c) => ['build_query', 'run_query', 'create_saved_view'].includes(c.tool))
      .map((c) => (c.input as { query_spec?: unknown }).query_spec),
    release_ids: releasesOf(calls),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
  };
  return { role: 'assistant', text, tool_calls: calls, provenance, refusal, usage };
}

/** Runs an approved write as the user; its audit reason says the assistant proposed it. */
export async function runApproved(
  ctx: ToolContext,
  call: AiToolCall,
  conversationId: string,
): Promise<AiToolCall> {
  const tool = toolByName(call.tool);
  if (!tool) return { ...call, status: 'error', error: `Unknown tool ${call.tool}.` };
  try {
    const output = await tool.run(ctx, call.input as never, {
      reason: `Proposed by the AI assistant (conversation ${conversationId}) and approved by the user`,
    });
    return { ...call, status: 'ok', output, error: null };
  } catch (error) {
    return { ...call, status: 'error', error: error instanceof Error ? error.message : String(error) };
  }
}
