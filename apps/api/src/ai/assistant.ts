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
import { modelTools, toolByName, TOOLS, ToolError, type ToolContext } from './tools.ts';

/** Bumped whenever SYSTEM_PROMPT changes; recorded in provenance (SPEC §11.6). */
export const PROMPT_VERSION = '2026-11-01.1';

export const SYSTEM_PROMPT = `You help drug-discovery scientists find and understand their own experiment data in this platform.
Use the tools to look things up; never answer from memory about the user's data. Tools run with the user's own
permissions, so if a tool says something is not found, say so plainly: do not guess what it might contain.
Ask for data only through QuerySpecs (build_query, then run_query); never write SQL or code. Show the user which
QuerySpec you ran and cite release ids. Report statistics exactly as the tools return them: log2 fold change is
log2(numerator / denominator) and adjusted p-values are as stored with the release. Keep answers short.`;

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
}

const errorText = (error: unknown) =>
  error instanceof ToolError || error instanceof Error ? error.message : String(error);

async function runTool(input: TurnInput, name: string, args: unknown): Promise<AiToolCall> {
  const tool = toolByName(name);
  let call: AiToolCall;
  if (!tool)
    call = { tool: name, status: 'error', input: args, output: null, error: `Unknown tool ${name}.` };
  else if (tool.risk === 'write')
    call = { tool: name, status: 'error', input: args, output: null, error: 'Write tools need approval.' };
  else {
    const parsed = tool.input.safeParse(args);
    if (!parsed.success)
      call = {
        tool: name,
        status: 'error',
        input: args,
        output: null,
        error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
      };
    else
      try {
        call = {
          tool: name,
          status: 'ok',
          input: args,
          output: await tool.run(input.ctx, parsed.data as never),
          error: null,
        };
      } catch (error) {
        call = { tool: name, status: 'error', input: args, output: null, error: errorText(error) };
      }
  }
  // SPEC §11.9: every tool call is audited as the assistant acting for the user (ids and outcome, no data rows).
  await insertAudit(
    input.db,
    { ...input.actor, kind: 'ai_assistant_on_behalf_of' },
    {
      action: 'ai.tool_call',
      entityType: 'ai_conversation',
      entityId: input.conversationId,
      after: { tool: name, status: call.status, input: args, error: call.error },
      reason: null,
    },
  );
  return call;
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
  const tools = modelTools(TOOLS.filter((t) => t.risk !== 'write'));
  let turn: ModelTurn | undefined;
  for (let step = 0; step <= MAX_STEPS; step++) {
    turn = await input.provider.complete({ system: SYSTEM_PROMPT, messages, tools });
    usage.input_tokens += turn.usage.input_tokens;
    usage.output_tokens += turn.usage.output_tokens;
    if (turn.refusal || !turn.tool_calls.length || step === MAX_STEPS) break;
    const content: ModelBlock[] = [
      ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
      ...turn.tool_calls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input })),
    ];
    messages.push({ role: 'assistant', content: providerContent(turn) ?? content });
    const results: ModelBlock[] = [];
    for (const c of turn.tool_calls) {
      const call = await runTool(input, c.name, c.input);
      calls.push(call);
      results.push({
        type: 'tool_result',
        tool_use_id: c.id,
        content: call.status === 'ok' ? JSON.stringify(call.output) : (call.error ?? 'error'),
        ...(call.status === 'ok' ? {} : { is_error: true }),
      });
    }
    messages.push({ role: 'user', content: results });
  }
  const refusal = turn?.refusal ? { category: turn.refusal.category } : null;
  // SPEC §11.7: a refusal is explained, and the user can rephrase around their own data.
  const text = refusal
    ? 'The model declined to answer this request. I can help you find and explain your own experiments and datasets — try asking about a specific experiment, dataset or release.'
    : turn?.text ||
      (calls.length ? 'I ran out of steps before finishing; the tool calls so far are shown.' : '');
  const provenance: AiProvenance = {
    provider: input.provider.name,
    model: input.provider.model,
    prompt_version: PROMPT_VERSION,
    tools: calls.map((c) => c.tool),
    query_specs: calls
      .filter((c) => c.tool === 'build_query' || c.tool === 'run_query')
      .map((c) => (c.input as { query_spec?: unknown }).query_spec),
    release_ids: releasesOf(calls),
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
  };
  return { role: 'assistant', text, tool_calls: calls, provenance, refusal, usage };
}
