import type { TriageDetail, TriageStatus } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { useMe } from '../auth.ts';
import { ErrorMessage } from '../components/ui.tsx';

const STATUSES: TriageStatus[] = ['new', 'advance', 'watch', 'drop'];

function describe(e: TriageDetail['events'][number]): string {
  switch (e.type) {
    case 'created':
      return 'added to the board';
    case 'status':
      return `${e.from} → ${e.to}${e.text ? ` — ${e.text}` : ''}`;
    case 'owner':
      return e.to ? 'owner changed' : 'owner cleared';
    case 'evidence':
      return 'evidence added';
    default:
      return e.text ?? '';
  }
}

/** One triage item: decide (with a reason), own, comment, and read its evidence and history (TRI-04). */
export function TriageItemPanel({ id }: { id: string }) {
  const me = useMe();
  const client = useQueryClient();
  const item = useQuery({
    queryKey: ['triage-item', id],
    queryFn: () => api('getTriage', { params: { id } }),
  });
  const [status, setStatus] = useState<TriageStatus | ''>('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['triage'] });
    await client.invalidateQueries({ queryKey: ['triage-item', id] });
  };
  const decide = useMutation({
    mutationFn: (body: { status?: TriageStatus; owner_id?: string | null; reason?: string }) =>
      api('updateTriage', { params: { id }, body, reason: body.reason ?? 'Triage owner change' }),
    onSuccess: async () => {
      setStatus('');
      setReason('');
      await refresh();
    },
  });
  const say = useMutation({
    mutationFn: () => api('commentTriage', { params: { id }, body: { text: comment.trim() } }),
    onSuccess: async () => {
      setComment('');
      await refresh();
    },
  });
  const d = item.data;
  if (!d) return <ErrorMessage error={item.error} />;
  const chosen = status || d.status;
  const entityLink =
    d.kind === 'protein' ? (
      <Link to="/proteins/$id" params={{ id: d.key }}>
        protein page
      </Link>
    ) : (
      <Link to="/compounds/$id" params={{ id: d.key }}>
        compound page
      </Link>
    );
  return (
    <section role="region" aria-label={`Triage item ${d.key}`} className="card stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
        {d.key}
        {d.label ? ` · ${d.label}` : ''}{' '}
        <span className="hint">
          ({d.program_code}, {d.kind})
        </span>
      </h2>
      <p style={{ margin: 0 }}>
        Owner: {d.owner_name ?? 'nobody'} · open the {entityLink}{' '}
        {me.data && d.owner_id !== me.data.user.id && (
          <button type="button" onClick={() => decide.mutate({ owner_id: me.data!.user.id })}>
            Assign to me
          </button>
        )}
      </p>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span>Decision</span>
          <select value={chosen} onChange={(e) => setStatus(e.target.value as TriageStatus)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4, flex: 1, minWidth: 240 }}>
          <span>Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this decision" />
        </label>
        <button
          type="button"
          className="primary"
          disabled={chosen === d.status || reason.trim().length < 3 || decide.isPending}
          onClick={() => decide.mutate({ status: chosen, reason: reason.trim() })}
        >
          Save decision
        </button>
      </div>
      <ErrorMessage error={decide.error} />
      <h3 style={{ margin: 0, fontSize: '1rem' }}>Evidence</h3>
      {d.evidence.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          No evidence attached yet.
        </p>
      ) : (
        <table aria-label="Evidence" className="data-table">
          <thead>
            <tr>
              {['dataset', 'contrast', 'log2 FC', 'adjusted p', 'added'].map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.evidence.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link to="/releases/$id" params={{ id: e.release_id }}>
                    {e.dataset_name}
                  </Link>
                </td>
                <td>{e.contrast_label ?? '—'}</td>
                <td>{e.log2_fc === null ? '—' : e.log2_fc.toPrecision(3)}</td>
                <td>{e.adj_p_value === null ? '—' : e.adj_p_value.toExponential(2)}</td>
                <td>
                  {e.added_by ?? ''} {new Date(e.added_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 style={{ margin: 0, fontSize: '1rem' }}>History</h3>
      <ol aria-label="History" className="stack" style={{ margin: 0, paddingLeft: 20 }}>
        {d.events.map((e) => (
          <li key={e.id}>
            <span className="hint">
              {new Date(e.at).toLocaleString()} · {e.actor ?? 'someone'}:
            </span>{' '}
            {e.type === 'comment' ? <q>{e.text}</q> : describe(e)}
          </li>
        ))}
      </ol>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="stack" style={{ gap: 4, flex: 1, minWidth: 240 }}>
          <span>Comment</span>
          <textarea value={comment} rows={2} onChange={(e) => setComment(e.target.value)} />
        </label>
        <button type="button" disabled={!comment.trim() || say.isPending} onClick={() => say.mutate()}>
          Add comment
        </button>
      </div>
      <ErrorMessage error={say.error} />
    </section>
  );
}
