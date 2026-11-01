import { useMutation } from '@tanstack/react-query';
import type { VersionDetail } from '@tributary/contracts';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { useRegistryInvalidation, useSamples } from './queries.ts';

interface Draft {
  numerator: string;
  denominator: string;
}

/** Comparisons between condition values. log2FC = log2(numerator / denominator); labels read "numerator vs denominator". */
export function ContrastsTab({ version, canEdit }: { version: VersionDetail; canEdit: boolean }) {
  const samples = useSamples(version.id);
  const invalidate = useRegistryInvalidation();
  const [list, setList] = useState<Draft[]>(() =>
    version.contrasts.map((c) => ({ numerator: c.numerator, denominator: c.denominator })),
  );
  const conditions = [
    ...new Set(samples.data?.items.map((s) => s.raw.condition ?? '').filter(Boolean)),
  ].sort();
  const [numerator, setNumerator] = useState('');
  const [denominator, setDenominator] = useState('');
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api('replaceContrasts', {
        params: { id: version.id },
        body: { contrasts: list },
        reason: 'Contrasts edit',
      }),
    onSuccess: async () => {
      setSaved(true);
      await invalidate();
    },
  });

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <ul>
        {list.map((c, i) => (
          <li key={`${c.numerator}|${c.denominator}`}>
            {c.numerator} vs {c.denominator}{' '}
            {canEdit && (
              <button
                type="button"
                className="danger"
                onClick={() => setList((l) => l.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!list.length && <p className="muted">No contrasts yet.</p>}
      {canEdit && (
        <>
          <div className="row">
            <Field label="Numerator">
              {(id) => (
                <select id={id} value={numerator} onChange={(e) => setNumerator(e.target.value)}>
                  <option value="">Choose…</option>
                  {conditions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Denominator">
              {(id) => (
                <select id={id} value={denominator} onChange={(e) => setDenominator(e.target.value)}>
                  <option value="">Choose…</option>
                  {conditions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              type="button"
              disabled={
                !numerator ||
                !denominator ||
                numerator === denominator ||
                list.some((c) => c.numerator === numerator && c.denominator === denominator)
              }
              onClick={() => {
                setList((l) => [...l, { numerator, denominator }]);
                setSaved(false);
              }}
            >
              Add contrast
            </button>
          </div>
          {!conditions.length && (
            <p className="muted">Add a condition column to the samples to define contrasts.</p>
          )}
          <div className="toolbar">
            <button type="button" className="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              Save contrasts
            </button>
            {saved && <span aria-live="polite">Contrasts saved</span>}
          </div>
          <ErrorMessage error={save.error} />
        </>
      )}
    </div>
  );
}
