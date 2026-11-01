import type { MetadataFieldDef } from '@tributary/contracts';
import type { CurationChange, CurationTarget } from './CurationDialog.tsx';

/** The manifest editor's edit actions (draft versions only). */
export function EditToolbar(props: {
  onUpload: (file: File) => void;
  onPaste: () => void;
  onAddRow: () => void;
  onDeleteRow: () => void;
  onAddColumn: () => void;
  onSuggest: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <div className="toolbar">
      <label className="button">
        Upload file
        <input
          type="file"
          aria-label="Manifest file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) props.onUpload(file);
          }}
        />
      </label>
      <button type="button" onClick={props.onPaste}>
        Paste TSV block
      </button>
      <button type="button" onClick={props.onAddRow}>
        Add row
      </button>
      <button type="button" onClick={props.onDeleteRow}>
        Delete row
      </button>
      <button type="button" onClick={props.onAddColumn}>
        Add column
      </button>
      <button type="button" onClick={props.onSuggest}>
        Suggest ontology terms
      </button>
      <button type="button" className="primary" disabled={props.busy} onClick={props.onSave}>
        Save samples
      </button>
    </div>
  );
}

/** Distinct values of each ontology-term column that do not validate (the ones worth a lookup). */
export function curationTargets(
  fields: MetadataFieldDef[],
  rows: { cells: Record<string, string> }[],
  errors: Map<number, Record<string, string>>,
): CurationTarget[] {
  return fields
    .filter((f) => f.type === 'ontology_term' && f.ontology)
    .map((f) => ({
      field: f.key,
      label: f.label,
      ontology: f.ontology!,
      values: [
        ...new Set(
          rows.flatMap((r, i) => {
            const value = r.cells[f.key]?.trim();
            return value && errors.get(i)?.[f.key] ? [value] : [];
          }),
        ),
      ].slice(0, 200),
    }))
    .filter((t) => t.values.length);
}

/** Replaces accepted values in their column (exact cell text), leaving everything else as it is. */
export function applyCuration<R extends { cells: Record<string, string> }>(
  rows: R[],
  changes: CurationChange[],
): R[] {
  return rows.map((r) => {
    let cells = r.cells;
    for (const c of changes) if (cells[c.field]?.trim() === c.from) cells = { ...cells, [c.field]: c.to };
    return cells === r.cells ? r : { ...r, cells };
  });
}
