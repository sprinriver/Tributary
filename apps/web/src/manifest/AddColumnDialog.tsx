import type { MetadataFieldDef } from '@tributary/contracts';
import { useState } from 'react';
import { Dialog, Field } from '../components/ui.tsx';

/** Adds a sample-level custom column (searchable flag drives search, SPEC M2). */
export function AddColumnDialog({
  open,
  onClose,
  taken,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  taken: string[];
  onAdd: (f: MetadataFieldDef) => void;
}) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<MetadataFieldDef['type']>('text');
  const [searchable, setSearchable] = useState(false);
  const problem = !/^[a-z][a-z0-9_]*$/.test(key)
    ? 'Use lower_snake_case'
    : taken.includes(key)
      ? 'That column already exists'
      : undefined;
  return (
    <Dialog title="Add sample column" open={open} onClose={onClose}>
      <div className="stack">
        <Field label="Key" error={key ? problem : undefined}>
          {(id) => <input id={id} value={key} onChange={(e) => setKey(e.target.value)} />}
        </Field>
        <Field label="Label">
          {(id) => <input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <Field label="Type">
          {(id) => (
            <select
              id={id}
              value={type}
              onChange={(e) => setType(e.target.value as MetadataFieldDef['type'])}
            >
              {['text', 'number', 'integer', 'boolean', 'date'].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </Field>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />
          Searchable
        </label>
        <div className="toolbar">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!!problem}
            onClick={() => {
              onAdd({ scope: 'sample', key, label: label || key, type, required: false, searchable });
              setKey('');
              setLabel('');
              setSearchable(false);
            }}
          >
            Add column
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Sample-level custom columns as removable chips; "(searchable)" marks columns indexed for search. */
export function SampleColumnChips({
  fields,
  readOnly,
  onRemove,
}: {
  fields: MetadataFieldDef[];
  readOnly: boolean;
  onRemove: (key: string) => void;
}) {
  if (!fields.length) return null;
  return (
    <ul aria-label="Sample columns" className="row" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {fields.map((f) => (
        <li
          key={f.key}
          className="row"
          style={{ gap: 4, border: '1px solid var(--border)', borderRadius: 12, padding: '2px 8px' }}
        >
          {f.key}
          {f.searchable ? ' (searchable)' : ''}
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove column ${f.key}`}
              onClick={() => onRemove(f.key)}
              style={{ padding: '0 6px' }}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
