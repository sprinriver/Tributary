import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { Field } from '../components/ui.tsx';
import type { ColumnMapping } from './mapping.ts';

interface Props {
  programId: string;
  headers: string[];
  columns: string[];
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  presetName: string;
  onPresetName: (name: string) => void;
}

/** Map uploaded headers to manifest columns; load a program preset or name the mapping to save it as one. */
export function MappingStep({
  programId,
  headers,
  columns,
  mapping,
  onChange,
  presetName,
  onPresetName,
}: Props) {
  const presets = useQuery({
    queryKey: ['mapping-presets', programId],
    queryFn: () => api('listMappingPresets', { params: { id: programId } }),
  });
  const [preset, setPreset] = useState('');

  return (
    <div className="stack">
      <Field label="Mapping preset">
        {(id) => (
          <select
            id={id}
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              const chosen = presets.data?.items.find((p) => p.id === e.target.value);
              if (chosen)
                onChange(Object.fromEntries(headers.map((h) => [h, chosen.mapping[h] ?? mapping[h] ?? ''])));
            }}
          >
            <option value="">None</option>
            {presets.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <table className="data" aria-label="Column mapping">
        <thead>
          <tr>
            <th scope="col">Uploaded column</th>
            <th scope="col">Manifest column</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header) => (
            <tr key={header}>
              <td>{header}</td>
              <td>
                <select
                  aria-label={`Map “${header}”`}
                  value={mapping[header] ?? ''}
                  onChange={(e) => onChange({ ...mapping, [header]: e.target.value })}
                >
                  <option value="">(ignore)</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Field label="Save mapping as preset" hint="Optional name; saved for everyone in this program">
        {(id) => <input id={id} value={presetName} onChange={(e) => onPresetName(e.target.value)} />}
      </Field>
    </div>
  );
}
