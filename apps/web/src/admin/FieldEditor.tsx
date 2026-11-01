import { MetadataFieldDefSchema, type MetadataFieldDef } from '@tributary/contracts';
import { useState } from 'react';
import { Field } from '../components/ui.tsx';

const TYPES = ['text', 'number', 'integer', 'boolean', 'date', 'enum', 'ontology_term', 'quantity'] as const;
const EMPTY = {
  key: '',
  label: '',
  type: 'text',
  scope: 'sample',
  enumValues: '',
  ontology: '',
  quantityKind: '',
};

/** Template field list with an add-field form; the new field is validated with the contract schema. */
export function FieldEditor({
  fields,
  keyField,
  onChange,
}: {
  fields: MetadataFieldDef[];
  keyField: string;
  onChange: (fields: MetadataFieldDef[]) => void;
}) {
  const [draft, setDraft] = useState(EMPTY);
  const [required, setRequired] = useState(false);
  const [searchable, setSearchable] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<typeof EMPTY>) => setDraft((d) => ({ ...d, ...patch }));

  const add = () => {
    const candidate = {
      scope: draft.scope,
      key: draft.key.trim(),
      label: draft.label.trim(),
      type: draft.type,
      required,
      searchable,
      ...(draft.type === 'enum'
        ? {
            enumValues: draft.enumValues
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          }
        : {}),
      ...(draft.type === 'ontology_term' ? { ontology: draft.ontology.trim() } : {}),
      ...(draft.type === 'quantity' ? { quantityKind: draft.quantityKind || undefined } : {}),
    };
    const parsed = MetadataFieldDefSchema.safeParse(candidate);
    if (!parsed.success)
      return setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    if (fields.some((f) => f.scope === parsed.data.scope && f.key === parsed.data.key))
      return setError(`"${parsed.data.key}" is already a ${parsed.data.scope} field.`);
    setError(undefined);
    onChange([...fields, parsed.data]);
    setDraft(EMPTY);
    setRequired(false);
    setSearchable(false);
  };

  return (
    <div className="stack">
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        <table className="data" aria-label="Fields">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Label</th>
              <th scope="col">Scope</th>
              <th scope="col">Type</th>
              <th scope="col">Required</th>
              <th scope="col">Searchable</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={`${f.scope}.${f.key}`}>
                <td>
                  <code>{f.key}</code>
                </td>
                <td>{f.label}</td>
                <td>{f.scope}</td>
                <td>{f.type}</td>
                <td>{f.required ? 'yes' : '—'}</td>
                <td>{f.searchable ? 'yes' : '—'}</td>
                <td>
                  {!(f.scope === 'sample' && f.key === keyField) && (
                    <button type="button" onClick={() => onChange(fields.filter((x) => x !== f))}>
                      Remove<span className="sr-only"> {f.key}</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset className="row" style={{ alignItems: 'flex-end' }}>
        <legend>Add a field</legend>
        <Field label="Key">
          {(id) => (
            <input
              id={id}
              value={draft.key}
              onChange={(e) => set({ key: e.target.value })}
              placeholder="lower_snake_case"
            />
          )}
        </Field>
        <Field label="Label">
          {(id) => <input id={id} value={draft.label} onChange={(e) => set({ label: e.target.value })} />}
        </Field>
        <Field label="Scope">
          {(id) => (
            <select id={id} value={draft.scope} onChange={(e) => set({ scope: e.target.value })}>
              <option value="sample">Sample</option>
              <option value="experiment">Experiment</option>
            </select>
          )}
        </Field>
        <Field label="Type">
          {(id) => (
            <select id={id} value={draft.type} onChange={(e) => set({ type: e.target.value })}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace('_', ' ')}
                </option>
              ))}
            </select>
          )}
        </Field>
        {draft.type === 'enum' && (
          <Field label="Allowed values (comma-separated)">
            {(id) => (
              <input id={id} value={draft.enumValues} onChange={(e) => set({ enumValues: e.target.value })} />
            )}
          </Field>
        )}
        {draft.type === 'ontology_term' && (
          <Field label="Ontology prefix">
            {(id) => (
              <input
                id={id}
                value={draft.ontology}
                onChange={(e) => set({ ontology: e.target.value })}
                placeholder="EFO"
              />
            )}
          </Field>
        )}
        {draft.type === 'quantity' && (
          <Field label="Quantity kind">
            {(id) => (
              <select
                id={id}
                value={draft.quantityKind}
                onChange={(e) => set({ quantityKind: e.target.value })}
              >
                <option value="">Choose…</option>
                <option value="concentration">Concentration</option>
                <option value="time">Time</option>
              </select>
            )}
          </Field>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />{' '}
          Required
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />{' '}
          Searchable
        </label>
        <button type="button" onClick={add}>
          Add field
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
    </div>
  );
}
