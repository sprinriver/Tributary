import type { CurationSuggestion } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { Dialog, ErrorMessage } from '../components/ui.tsx';

export interface CurationTarget {
  field: string;
  label: string;
  ontology: string;
  values: string[];
}
export interface CurationChange {
  field: string;
  from: string;
  to: string;
}

const key = (field: string, value: string) => `${field}\u0000${value}`;

/**
 * Ontology terms for free-text values (SPEC M12 curation, §11.5). Suggestions come only from ontology lookups;
 * nothing is applied until the user ticks it and presses "Apply accepted", and the grid still has to be saved.
 */
export function CurationDialog({
  targets,
  onClose,
  onApply,
}: {
  targets: CurationTarget[];
  onClose: () => void;
  onApply: (changes: CurationChange[]) => void;
}) {
  const suggestions = useQuery({
    queryKey: ['curation', targets],
    queryFn: () =>
      Promise.all(
        targets.map(async (t) => ({
          target: t,
          items: (await api('suggestCurationTerms', { body: { ontology: t.ontology, values: t.values } }))
            .items,
        })),
      ),
    staleTime: Infinity,
  });
  const [accepted, setAccepted] = useState<Map<string, string>>(new Map());
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const choiceOf = (field: string, s: CurationSuggestion) =>
    s.term?.label ?? picked.get(key(field, s.value)) ?? s.candidates[0]?.label;
  return (
    <Dialog title="Suggested ontology terms" open onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Terms come from the ontology lookup only. Tick the ones to use; they are applied to the grid, and
          saved with “Save samples”.
        </p>
        <ErrorMessage error={suggestions.error} />
        {suggestions.isPending && <p>Looking up terms…</p>}
        {suggestions.data && !targets.length && <p>No free-text ontology values to check.</p>}
        {suggestions.data && targets.length > 0 && (
          <table className="data" aria-label="Suggestions">
            <thead>
              <tr>
                <th scope="col">Column</th>
                <th scope="col">Value</th>
                <th scope="col">Suggestion</th>
                <th scope="col">Accept</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.data.flatMap(({ target, items }) =>
                items.map((s) => {
                  const k = key(target.field, s.value);
                  const choice = choiceOf(target.field, s);
                  return (
                    <tr key={k}>
                      <td>{target.label}</td>
                      <th scope="row">{s.value}</th>
                      <td>
                        {s.term ? (
                          <>
                            {s.term.label} <code>{s.term.id}</code>
                          </>
                        ) : s.candidates.length ? (
                          <>
                            No match.{' '}
                            <select
                              aria-label={`Lookup results for ${s.value}`}
                              value={choice}
                              onChange={(e) => setPicked((m) => new Map(m).set(k, e.target.value))}
                            >
                              {s.candidates.map((c) => (
                                <option key={c.id} value={c.label}>
                                  {c.label} ({c.id})
                                </option>
                              ))}
                            </select>
                          </>
                        ) : (
                          'No match'
                        )}
                      </td>
                      <td>
                        {choice && (
                          <input
                            type="checkbox"
                            aria-label={`Accept ${choice} for ${s.value}`}
                            checked={accepted.has(k)}
                            onChange={(e) =>
                              setAccepted((m) => {
                                const next = new Map(m);
                                if (e.target.checked) next.set(k, choice);
                                else next.delete(k);
                                return next;
                              })
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        )}
        <div className="toolbar">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!accepted.size}
            onClick={() =>
              onApply(
                [...accepted].map(([k, to]) => {
                  const [field, from] = k.split('\u0000') as [string, string];
                  return { field, from, to };
                }),
              )
            }
          >
            Apply accepted
          </button>
        </div>
      </div>
    </Dialog>
  );
}
