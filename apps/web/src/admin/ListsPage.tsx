import type { PicklistKind } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage, Field } from '../components/ui.tsx';

const LISTS: { kind: PicklistKind; title: string; hint: string; needsLabel: boolean }[] = [
  { kind: 'species', title: 'Species', hint: 'NCBI Taxonomy id, e.g. NCBITaxon:9606', needsLabel: true },
  { kind: 'spectral_library', title: 'Spectral libraries', hint: 'Library name', needsLabel: false },
  { kind: 'time_point', title: 'Time points', hint: 'A time with a unit, e.g. 24 h', needsLabel: false },
];

export function ListsPage() {
  return (
    <RequireAuth>
      <main className="stack">
        <h1>Lists and ontology sources</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          The values registry forms offer. Until a list is saved here, the product's defaults are used.
        </p>
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}
        >
          {LISTS.map((l) => (
            <PicklistEditor key={l.kind} {...l} />
          ))}
        </div>
        <OntologySources />
      </main>
    </RequireAuth>
  );
}

function PicklistEditor({ kind, title, hint, needsLabel }: (typeof LISTS)[number]) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ['picklist', kind],
    queryFn: () => api('getPicklist', { query: { kind } }),
  });
  const [values, setValues] = useState<{ value: string; label: string }[] | null>(null);
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const current = values ?? list.data?.values ?? [];
  const duplicate = current.some((v) => v.value === value.trim());
  const save = useMutation({
    mutationFn: () =>
      api('putPicklist', { params: { kind }, body: { values: current }, reason: `Edit ${title}` }),
    onSuccess: async (saved) => {
      setValues(saved.values);
      await client.invalidateQueries({ queryKey: ['picklist', kind] });
    },
  });
  return (
    <section className="card stack" aria-label={title}>
      <h2 style={{ margin: 0 }}>
        {title}
        {list.data?.built_in && values === null && (
          <small style={{ color: 'var(--muted)' }}> (defaults)</small>
        )}
      </h2>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {current.map((v) => (
          <li key={v.value}>
            {v.label}
            {v.label !== v.value && <code style={{ marginLeft: 6 }}>{v.value}</code>}{' '}
            <button type="button" onClick={() => setValues(current.filter((x) => x.value !== v.value))}>
              Remove<span className="sr-only"> {v.value}</span>
            </button>
          </li>
        ))}
        {!current.length && <li style={{ color: 'var(--muted)' }}>No values</li>}
      </ul>
      <div className="row">
        <Field label="New value" hint={hint}>
          {(id) => <input id={id} value={value} onChange={(e) => setValue(e.target.value)} />}
        </Field>
        {needsLabel && (
          <Field label="Label">
            {(id) => <input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
        )}
        <button
          type="button"
          // Until the saved list has loaded, adding would replace it with only the new value.
          disabled={!value.trim() || !list.data || duplicate}
          onClick={() => {
            setValues([
              ...current,
              { value: value.trim(), label: (needsLabel ? label : value).trim() || value.trim() },
            ]);
            setValue('');
            setLabel('');
          }}
        >
          Add
        </button>
      </div>
      {duplicate && (
        <p style={{ margin: 0, color: 'var(--muted)' }}>{value.trim()} is already in the list.</p>
      )}
      <div className="row" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className="primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || !list.data}
        >
          Save {title.toLowerCase()}
        </button>
        {save.isSuccess && <span role="status">Saved</span>}
      </div>
      <ErrorMessage error={save.error} />
    </section>
  );
}

function OntologySources() {
  const client = useQueryClient();
  const sources = useQuery({ queryKey: ['ontology-sources'], queryFn: () => api('getOntologySources') });
  const [enabled, setEnabled] = useState<Set<string> | null>(null);
  const current =
    enabled ?? new Set(sources.data?.sources.filter((s) => s.enabled).map((s) => s.prefix) ?? []);
  const save = useMutation({
    mutationFn: () =>
      api('putOntologySources', { body: { enabled: [...current] }, reason: 'Ontology sources' }),
    onSuccess: async () => {
      setEnabled(null);
      await client.invalidateQueries({ queryKey: ['ontology-sources'] });
    },
  });
  return (
    <section className="card stack" aria-label="Ontology sources">
      <h2 style={{ margin: 0 }}>Ontology sources</h2>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Lookups go to {sources.data?.ols_url ?? 'the ontology service'}. A source switched off is not looked
        up in the manifest editor; terms already stored stay valid.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
        {(sources.data?.sources ?? []).map((s) => (
          <label key={s.prefix} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={current.has(s.prefix)}
              onChange={(e) => {
                const next = new Set(current);
                if (e.target.checked) next.add(s.prefix);
                else next.delete(s.prefix);
                setEnabled(next);
              }}
            />
            <span>
              <strong>{s.prefix}</strong> — {s.label}
            </span>
          </label>
        ))}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save sources
        </button>
        {save.isSuccess && enabled === null && <span role="status">Saved</span>}
      </div>
      <ErrorMessage error={save.error} />
    </section>
  );
}
