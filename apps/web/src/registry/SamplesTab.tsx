import { useMutation } from '@tanstack/react-query';
import type { ContractError, VersionDetail } from '@tributary/contracts';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { useRegistryInvalidation, useSamples } from './queries.ts';
import { parseTsv } from './tsv.ts';

const SHOWN = ['sample_key', 'source_name', 'organism', 'cell_line', 'compound_id', 'dose', 'time', 'well'];

export function SamplesTab({ version, canEdit }: { version: VersionDetail; canEdit: boolean }) {
  const samples = useSamples(version.id);
  const invalidate = useRegistryInvalidation();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ saved: number; errors: ContractError[] } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api('upsertSamples', {
        params: { id: version.id },
        body: { rows: parseTsv(text) },
        reason: 'Manifest paste',
      }),
    onSuccess: async (r) => {
      setResult(r);
      setText('');
      await invalidate();
    },
  });
  const columns = [
    ...new Set([...SHOWN, ...(samples.data?.items.flatMap((s) => Object.keys(s.raw)) ?? [])]),
  ].filter((c) => samples.data?.items.some((s) => s.raw[c]));

  return (
    <div className="stack">
      {canEdit && (
        <div className="stack" style={{ maxWidth: 900 }}>
          <Field
            label="Paste TSV"
            hint="First row: column names (sample_key, source_name, organism, …). Rows with an existing sample_key are updated."
          >
            {(id) => <textarea id={id} rows={6} value={text} onChange={(e) => setText(e.target.value)} />}
          </Field>
          <div className="toolbar">
            <button
              type="button"
              className="primary"
              disabled={!text.trim() || save.isPending}
              onClick={() => save.mutate()}
            >
              Save samples
            </button>
          </div>
          <ErrorMessage error={save.error} />
          {result && (
            <div aria-live="polite">
              <p>{result.saved} samples saved</p>
              {result.errors.length > 0 && (
                <ul className="cell-error">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      <code>{e.field}</code> {e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <table className="data" aria-label="Samples">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
            <th scope="col">Problems</th>
          </tr>
        </thead>
        <tbody>
          {samples.data?.items.map((s) => (
            <tr key={s.id}>
              {columns.map((c) => (
                <td
                  key={c}
                  className={s.validation_errors[c] ? 'cell-error' : undefined}
                  title={s.validation_errors[c]}
                >
                  {s.raw[c] ?? ''}
                </td>
              ))}
              <td className="cell-error">
                {Object.entries(s.validation_errors)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('; ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {samples.data && !samples.data.items.length && <p className="muted">No samples yet.</p>}
    </div>
  );
}
