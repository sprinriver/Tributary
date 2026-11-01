import { FIELD_ONTOLOGY } from './tools-write.ts';
import type { ModelBlock, ModelMessage, ModelProvider, ModelRequest, ModelTurn } from './provider.ts';

/**
 * A deterministic stand-in for a model (tests, CI, the golden eval and local demos): it maps a few question shapes
 * to tool calls and summarises tool results. It never sees data the tools did not return.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const STOP = new Set(
  'find which what show list experiments experiment with use uses used using are is the a an of in cells cell screens screen compound did'.split(
    ' ',
  ),
);

/** Search words of a question: drop question words and punctuation (keeps hyphenated names such as K-562). */
export function searchTerms(question: string): string {
  return question
    .replace(/[?.!,]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()))
    .join(' ');
}

const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4);

function lastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

interface Result {
  name: string;
  ok: boolean;
  output: Record<string, unknown>;
}

/** Tool results of the current turn (after the last plain-text user message), oldest first. */
function results(messages: ModelMessage[]): Result[] {
  const names = new Map<string, string>();
  const out: Result[] = [];
  let start = 0;
  messages.forEach((m, i) => {
    if (m.role === 'user' && typeof m.content === 'string') start = i;
  });
  for (const m of messages.slice(start)) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content as ModelBlock[]) {
      if (b.type === 'tool_use') names.set(b.id, b.name);
      if (b.type === 'tool_result')
        out.push({
          name: names.get(b.tool_use_id) ?? '',
          ok: !b.is_error,
          output: b.is_error ? { error: b.content } : (JSON.parse(b.content) as Record<string, unknown>),
        });
    }
  }
  return out;
}

const TERM_ID = /\b[A-Za-z]+:[A-Za-z0-9_]+\b/;

function plan(question: string): { name: string; input: unknown } {
  const id = UUID.exec(question)?.[0];
  const saveView = /save a view of release (\S+) named (.+)$/i.exec(question);
  if (saveView)
    return {
      name: 'create_saved_view',
      input: { name: saveView[2]!.trim(), query_spec: { source: { releaseIds: [saveView[1]] } } },
    };
  const fix = /fix the (\w+) terms in version/i.exec(question);
  if (fix && id)
    return {
      name: 'suggest_ontology_terms',
      input: { ontology: FIELD_ONTOLOGY[fix[1]!] ?? fix[1], version_id: id, field: fix[1] },
    };
  const set = /set (\w+) "([^"]+)" to (\S+) in version/i.exec(question);
  if (set && id && TERM_ID.test(set[3]!))
    return {
      name: 'apply_metadata_suggestions',
      input: {
        version_id: id,
        field: set[1],
        ontology: FIELD_ONTOLOGY[set[1]!] ?? set[3]!.split(':')[0],
        changes: [{ from: set[2], term_id: set[3] }],
      },
    };
  if (/invalid query/i.test(question)) return { name: 'build_query', input: { query_spec: { source: {} } } };
  if (id && /release/i.test(question))
    return {
      name: 'build_query',
      input: { query_spec: { source: { releaseIds: [id] }, page: { size: 25 } } },
    };
  if (id && /lineage/i.test(question)) return { name: 'get_lineage', input: { kind: 'experiment', id } };
  if (id && /result/i.test(question)) return { name: 'get_results_summary', input: { version_id: id } };
  if (id) return { name: 'get_experiment', input: { id } };
  if (/^list datasets|datasets\b/i.test(question)) return { name: 'list_datasets', input: {} };
  return { name: 'search_experiments', input: { query: searchTerms(question) || question } };
}

function summarise(question: string, last: Result): string {
  if (!last.ok) return `I could not do that: ${String(last.output.error)}`;
  const o = last.output;
  if (o.status === 'pending_approval')
    return `I have proposed ${last.name.replaceAll('_', ' ')}. Approve or reject it below; nothing changes until you approve.`;
  switch (last.name) {
    case 'search_experiments': {
      const hits = (o.experiments as { name: string }[]) ?? [];
      return hits.length
        ? `Found ${hits.length} experiment${hits.length > 1 ? 's' : ''} in your programs: ${hits.map((h) => h.name).join(', ')}.`
        : `No experiments in your programs match "${searchTerms(question) || question}".`;
    }
    case 'run_query':
      return `The query returned ${(o.rows as unknown[]).length} rows (first page). Open it in the Explorer to filter or export.`;
    case 'get_experiment':
      return `${String(o.name)} (${String(o.assay_type)}, program ${String(o.program_code)}).`;
    case 'suggest_ontology_terms': {
      const items = o.items as { value: string; term: { label: string } | null }[];
      return items.length
        ? items.map((i) => `${i.value}: ${i.term ? i.term.label : 'no match'}`).join('; ')
        : 'No values need a term.';
    }
    case 'list_datasets':
      return `You can see ${(o.datasets as unknown[]).length} datasets.`;
    default:
      return `Done: ${last.name}.`;
  }
}

export function stubProvider(model: string): ModelProvider {
  let n = 0;
  return {
    name: 'stub',
    model,
    async complete(request: ModelRequest): Promise<ModelTurn> {
      const question = lastUserText(request.messages);
      const done = results(request.messages);
      const usage = { input_tokens: tokens(request.messages), output_tokens: 0 };
      const call = (name: string, input: unknown): ModelTurn => {
        const turn = { text: '', tool_calls: [{ id: `stub_${++n}`, name, input }], stop: 'tool_use', usage };
        usage.output_tokens = tokens(turn.tool_calls);
        return turn;
      };
      if (!done.length) {
        const next = plan(question);
        return call(next.name, next.input);
      }
      const last = done[done.length - 1]!;
      // A validated query is run next (first page only).
      if (last.name === 'build_query' && last.ok)
        return call('run_query', { query_spec: last.output.query_spec });
      // Matched terms of a version's field are proposed as one change (the user approves it).
      if (last.name === 'suggest_ontology_terms' && last.ok && last.output.version_id) {
        const matched = (last.output.items as { value: string; term: { id: string } | null }[]).filter(
          (i) => i.term,
        );
        if (matched.length)
          return call('apply_metadata_suggestions', {
            version_id: last.output.version_id,
            field: last.output.field,
            ontology: last.output.ontology,
            changes: matched.map((i) => ({ from: i.value, term_id: i.term!.id })),
          });
      }
      const text = summarise(question, last);
      usage.output_tokens = tokens(text);
      return { text, tool_calls: [], stop: 'end_turn', usage };
    },
  };
}
