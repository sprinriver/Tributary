import { useQuery } from '@tanstack/react-query';
import type { CustomCellEditorProps } from 'ag-grid-react';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.ts';

export interface OntologyEditorParams {
  ontology: string;
  /** Remember picked terms so client-side validation accepts them. */
  onPick: (term: { id: string; label: string }) => void;
}

/** Typeahead cell editor backed by `/v1/ontology/search` (OLS4 through the API, cached in Postgres). */
export function OntologyEditor(props: CustomCellEditorProps & OntologyEditorParams) {
  const [text, setText] = useState(String(props.value ?? ''));
  const [debounced, setDebounced] = useState(text);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const results = useQuery({
    queryKey: ['ontology', props.ontology, debounced.toLowerCase()],
    queryFn: () => api('searchOntology', { query: { ontology: props.ontology, q: debounced } }),
    enabled: debounced.length >= 2,
    staleTime: 300_000,
  });
  const items = results.data?.items ?? [];
  const pick = (term: { id: string; label: string }) => {
    props.onPick(term);
    props.onValueChange(term.label);
    setText(term.label);
    setTimeout(() => props.stopEditing(), 0);
  };

  return (
    <div
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: 4, minWidth: 260 }}
    >
      <input
        ref={input}
        role="combobox"
        aria-label={props.colDef.field ?? 'term'}
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          props.onValueChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && items[0] && items[0].label.toLowerCase() === text.toLowerCase())
            pick(items[0]);
        }}
        style={{ width: '100%' }}
      />
      {items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 200, overflowY: 'auto' }}
        >
          {items.map((term) => (
            <li
              key={term.id}
              role="option"
              aria-selected={term.label === text}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(term)}
              style={{ padding: '4px 6px', cursor: 'pointer' }}
            >
              {term.label} <span className="muted">{term.id}</span>
            </li>
          ))}
        </ul>
      )}
      {results.data?.source === 'local' && (
        <p className="muted" style={{ margin: 4 }}>
          Ontology service offline: showing known terms.
        </p>
      )}
    </div>
  );
}
