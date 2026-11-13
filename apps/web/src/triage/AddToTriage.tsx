import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { useMe } from '../auth.ts';
import { ErrorMessage } from '../components/ui.tsx';

/** "Add to triage" for a protein or compound page (Phase 25, TRI-04): one item per program, kind and key. */
export function AddToTriage({
  kind,
  itemKey,
  label,
}: {
  kind: 'protein' | 'compound';
  itemKey: string;
  label?: string;
}) {
  const me = useMe();
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });
  // Programs where the caller can contribute (viewers can read the board but not add to it).
  const writable = new Set(
    (me.data?.roles ?? []).filter((r) => r.role !== 'viewer').map((r) => r.program_id),
  );
  const isAdmin = (me.data?.roles ?? []).some((r) => r.role === 'system_admin');
  const options = (programs.data?.items ?? []).filter((p) => isAdmin || writable.has(p.id));
  const [program, setProgram] = useState('');
  const chosen = program || options[0]?.id || '';
  const add = useMutation({
    mutationFn: () =>
      api('createTriage', {
        body: { program_id: chosen, kind, key: itemKey, ...(label ? { label } : {}) },
        reason: 'Added to the triage board',
      }),
  });
  if (options.length === 0) return null;
  return (
    <section role="region" aria-label="Triage" className="card stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Triage</h2>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span>Program</span>
          <select value={chosen} onChange={(e) => setProgram(e.target.value)}>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="primary"
          disabled={!chosen || add.isPending}
          onClick={() => add.mutate()}
        >
          Add to triage
        </button>
        {add.data && (
          <Link to="/triage" search={{ item: add.data.id }}>
            Open on the triage board
          </Link>
        )}
      </div>
      <ErrorMessage error={add.error} />
    </section>
  );
}
