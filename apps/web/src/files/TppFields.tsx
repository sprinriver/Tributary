import { Field } from '../components/ui.tsx';
import { parseTemperatures, type TppDraft } from './tpp-options.ts';

/** Import dialog fields of the TPP-TR importer: what the result table does not carry (SOURCE.md). */
export function TppFields({ value, onChange }: { value: TppDraft; onChange: (next: TppDraft) => void }) {
  const parsed = parseTemperatures(value.temperatures);
  return (
    <>
      <Field label="Compound ID" hint="The compound of the treatment experiments">
        {(id) => (
          <input
            id={id}
            value={value.compound_id}
            onChange={(e) => onChange({ ...value, compound_id: e.target.value })}
          />
        )}
      </Field>
      <Field label="Protein_ID holds" hint="TPP’s default identifier is the gene name; this is never guessed">
        {(id) => (
          <select
            id={id}
            value={value.feature_type}
            onChange={(e) => onChange({ ...value, feature_type: e.target.value as TppDraft['feature_type'] })}
          >
            <option value="">Choose…</option>
            <option value="gene">Gene symbols</option>
            <option value="protein_group">Protein accessions</option>
          </select>
        )}
      </Field>
      <Field
        label="Temperatures (°C)"
        hint="One line per label, as in the TPP config table: the label, then its temperature. The same for every experiment."
      >
        {(id) => (
          <textarea
            id={id}
            rows={6}
            placeholder={'126 37\n127L 41\n127H 44'}
            value={value.temperatures}
            onChange={(e) => onChange({ ...value, temperatures: e.target.value })}
            aria-invalid={value.temperatures.trim() !== '' && 'error' in parsed}
          />
        )}
      </Field>
      {value.temperatures.trim() !== '' && 'error' in parsed && <span className="error">{parsed.error}</span>}
    </>
  );
}
