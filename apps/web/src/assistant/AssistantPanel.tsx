import type { AiMessage, AiToolCall } from '@tributary/contracts';
import { Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { ErrorMessage } from '../components/ui.tsx';

/** `/explore?q=…` from a tool's explorer_url, as router search params. */
function explorerSearch(url: string): { q: string } | null {
  const q = new URL(url, window.location.origin).searchParams.get('q');
  return q ? { q } : null;
}

/** One tool call (SPEC M12: always show the QuerySpec or chart spec that ran, with "open in Explorer"). */
const STATUS: Record<AiToolCall['status'], string> = {
  ok: 'ran',
  error: 'failed',
  pending_approval: 'needs approval',
  rejected: 'rejected',
};

/** Approve or reject a proposed write (SPEC §11.4); an approved write runs with the user's own permissions. */
function Decision({
  conversation,
  call,
  onDecided,
}: {
  conversation: string;
  call: AiToolCall;
  onDecided: (c: AiToolCall) => void;
}) {
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      api('decideAiToolCall', { params: { id: conversation, callId: call.id }, body: { approve } }),
    onSuccess: onDecided,
  });
  return (
    <>
      <p>Waiting for your approval. Nothing changes until you approve.</p>
      <details>
        <summary>Proposed change</summary>
        <pre>{JSON.stringify(call.input, null, 2)}</pre>
      </details>
      <div className="toolbar">
        <button
          type="button"
          className="primary"
          disabled={decide.isPending}
          onClick={() => decide.mutate(true)}
        >
          Approve
        </button>
        <button type="button" disabled={decide.isPending} onClick={() => decide.mutate(false)}>
          Reject
        </button>
      </div>
      <ErrorMessage error={decide.error} />
    </>
  );
}

function ToolCard({
  call,
  conversation,
  onDecided,
}: {
  call: AiToolCall;
  conversation?: string | undefined;
  onDecided: (c: AiToolCall) => void;
}) {
  const output = call.output as Record<string, unknown> | null;
  const spec = (output?.query_spec ?? (call.input as { query_spec?: unknown } | null)?.query_spec) as
    unknown | undefined;
  const link = typeof output?.explorer_url === 'string' ? explorerSearch(output.explorer_url) : null;
  const rows = Array.isArray(output?.rows) ? (output.rows as unknown[]) : null;
  return (
    <article className={`ai-tool ai-tool-${call.status}`} aria-label={`${call.tool} (${call.status})`}>
      <header>
        <code>{call.tool}</code>
        <span
          className={call.status === 'ok' ? 'ai-ok' : call.status === 'error' ? 'ai-error' : 'ai-pending'}
        >
          {STATUS[call.status]}
        </span>
      </header>
      {call.error && <p className="ai-error-text">{call.error}</p>}
      {call.status === 'pending_approval' && conversation && (
        <Decision conversation={conversation} call={call} onDecided={onDecided} />
      )}
      {spec !== undefined && call.tool === 'build_query' && (
        <details open>
          <summary>QuerySpec</summary>
          <pre>{JSON.stringify(spec, null, 2)}</pre>
        </details>
      )}
      {rows && (
        <p>
          {rows.length} rows shown
          {typeof output?.total_rows === 'number'
            ? ` of ${output.total_rows}${output.total_capped ? '+' : ''}`
            : ''}
        </p>
      )}
      {call.status === 'ok' && typeof output?.view_id === 'string' && (
        <Link to="/explore" search={{ view: output.view_id }} className="button">
          Open view
        </Link>
      )}
      {link && (
        <Link to="/explore" search={link} className="button">
          Open in Explorer
        </Link>
      )}
      {call.status === 'ok' && !rows && call.tool !== 'build_query' && (
        <details>
          <summary>Output</summary>
          <pre>{JSON.stringify(output, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}

function Message({
  message,
  conversation,
  onDecided,
}: {
  message: AiMessage;
  conversation?: string | undefined;
  onDecided: (c: AiToolCall) => void;
}) {
  return (
    <div className={`ai-msg ai-${message.role}`}>
      {message.role === 'assistant' &&
        message.tool_calls.map((c) => (
          <ToolCard key={c.id} call={c} conversation={conversation} onDecided={onDecided} />
        ))}
      {message.text && <p className="ai-text">{message.text}</p>}
      {message.provenance && (
        <p className="ai-prov">
          {message.provenance.provider} · {message.provenance.model} · prompt{' '}
          {message.provenance.prompt_version}
          {message.provenance.release_ids.length
            ? ` · releases ${message.provenance.release_ids.join(', ')}`
            : ''}
        </p>
      )}
    </div>
  );
}

/** The assistant side panel (SPEC M12): questions in, tool calls and answers out, each tool call shown. */
export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [conversation, setConversation] = useState<string>();
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);
  const send = useMutation({
    mutationFn: async (question: string) => {
      const id = conversation ?? (await api('createAiConversation', { body: {} })).id;
      setConversation(id);
      return api('postAiMessage', { params: { id }, body: { text: question } });
    },
    onMutate: (question) => {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'user',
          text: question,
          tool_calls: [],
          provenance: null,
          refusal: null,
          created_at: new Date().toISOString(),
        },
      ]);
      setText('');
    },
    onSuccess: (turn) => setMessages((m) => [...m, turn]),
  });
  const submit = () => {
    if (text.trim() && !send.isPending) send.mutate(text.trim());
  };
  return (
    <aside className="ai-panel" aria-label="Assistant">
      <header className="ai-head">
        <h2>
          <Icon name="sparkle" size={16} /> Assistant
        </h2>
        <button type="button" className="tb-round" onClick={onClose} aria-label="Close assistant">
          ×
        </button>
      </header>
      <p className="ai-note">
        Answers come from tools that run with your permissions. Check the QuerySpec and rows before you rely
        on them.
      </p>
      <div className="ai-log" role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            conversation={conversation}
            onDecided={(decided) =>
              setMessages((all) =>
                all.map((x) => ({
                  ...x,
                  tool_calls: x.tool_calls.map((c) => (c.id === decided.id ? decided : c)),
                })),
              )
            }
          />
        ))}
        {send.isPending && <p className="ai-pending">Working…</p>}
        <div ref={end} />
      </div>
      <ErrorMessage error={send.error} />
      <form
        className="ai-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="ai-input" className="sr-only">
          Ask the assistant
        </label>
        <textarea
          id="ai-input"
          ref={input}
          rows={2}
          value={text}
          placeholder="e.g. Find experiments with HEK293"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="submit" className="primary" disabled={!text.trim() || send.isPending}>
          Send
        </button>
      </form>
    </aside>
  );
}
