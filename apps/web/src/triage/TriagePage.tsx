import type { TriageItem, TriageStatus } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { TriageItemPanel } from './TriageItemPanel.tsx';

export interface TriageSearch {
  item?: string;
  program_id?: string;
  kind?: 'protein' | 'compound';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const COLUMNS: { status: TriageStatus; title: string }[] = [
  { status: 'new', title: 'New' },
  { status: 'advance', title: 'Advance' },
  { status: 'watch', title: 'Watch' },
  { status: 'drop', title: 'Drop' },
];

/**
 * Hit triage board (Phase 25, TRI-04): one column per decision. Cards are buttons (keyboard and screen reader friendly);
 * decisions are made in the item panel with a reason, never by dragging.
 */
export function TriagePage() {
  const search = useSearch({ from: '/triage' });
  const navigate = useNavigate({ from: '/triage' });
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });
  const board = useQuery({
    queryKey: ['triage', search.program_id, search.kind],
    queryFn: () =>
      api('listTriage', {
        query: {
          ...(search.program_id ? { program_id: search.program_id } : {}),
          ...(search.kind ? { kind: search.kind } : {}),
        },
      }),
  });
  const items = board.data?.items ?? [];
  /** Merges into the URL; an undefined value removes that filter. */
  const setSearch = (next: { [K in keyof TriageSearch]?: TriageSearch[K] | undefined }) =>
    void navigate({
      search: (prev: TriageSearch) =>
        Object.fromEntries(
          Object.entries({ ...prev, ...next }).filter(([, v]) => v !== undefined),
        ) as TriageSearch,
    });
  const card = (i: TriageItem) => (
    <li key={i.id}>
      <button
        type="button"
        className={`card ${search.item === i.id ? 'selected' : ''}`}
        aria-pressed={search.item === i.id}
        style={{ width: '100%', textAlign: 'left', display: 'block' }}
        onClick={() => setSearch({ item: i.id })}
      >
        <strong>{i.key}</strong>
        {i.label ? ` · ${i.label}` : ''}
        <br />
        <span className="hint">
          {i.program_code} · {i.kind} · {i.owner_name ?? 'no owner'} ·{' '}
          {plural(i.evidence_count, 'evidence', 'evidence')} ·{' '}
          {plural(i.comment_count, 'comment', 'comments')}
        </span>
      </button>
    </li>
  );
  return (
    <main style={{ padding: 24 }} className="stack">
      <h1 style={{ margin: 0 }}>Triage board</h1>
      <p className="hint" style={{ margin: 0 }}>
        Proteins and compounds your programs are deciding on. Every decision keeps its reason and is audited.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span>Program</span>
          <select
            value={search.program_id ?? ''}
            onChange={(e) => setSearch({ program_id: e.target.value || undefined })}
          >
            <option value="">All my programs</option>
            {programs.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span>Kind</span>
          <select
            value={search.kind ?? ''}
            onChange={(e) => setSearch({ kind: (e.target.value || undefined) as TriageSearch['kind'] })}
          >
            <option value="">Proteins and compounds</option>
            <option value="protein">Proteins</option>
            <option value="compound">Compounds</option>
          </select>
        </label>
      </div>
      <ErrorMessage error={board.error} />
      {board.data && items.length === 0 && (
        <p className="hint">Nothing on the board yet: use “Add to triage” on a protein or compound page.</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {COLUMNS.map((c) => {
          const inColumn = items.filter((i) => i.status === c.status);
          const title = `${c.title} (${inColumn.length})`;
          return (
            <section key={c.status} role="region" aria-label={title} className="stack">
              <h2 style={{ margin: 0, fontSize: '1rem' }}>{title}</h2>
              <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {inColumn.map(card)}
              </ul>
            </section>
          );
        })}
      </div>
      {search.item && <TriageItemPanel id={search.item} />}
    </main>
  );
}
