import type { ReactNode } from 'react';
import { useState } from 'react';
import { Dialog, ErrorMessage, Field } from '../components/ui.tsx';
import { applyMapping, guessMapping, type ColumnMapping } from './mapping.ts';
import { MappingStep } from './MappingStep.tsx';
import { delimiterName, type ParsedTable } from './parse-core.ts';
import { parseInWorker } from './parse.ts';

export interface ApplyArgs {
  rows: Record<string, string>[];
  mapping: ColumnMapping;
  presetName: string;
}

interface CommonProps {
  programId: string;
  columns: string[];
  onApply: (args: ApplyArgs) => Promise<void> | void;
}

/** Uploaded file → preview (row count, delimiter, first rows) → column mapping → apply to the grid. */
export function UploadPreview({
  table,
  onCancel,
  ...props
}: CommonProps & { table: ParsedTable; onCancel: () => void }) {
  const [mapping, setMapping] = useState<ColumnMapping>(() => guessMapping(table.fields, props.columns));
  const [presetName, setPresetName] = useState('');
  return (
    <section
      role="region"
      aria-label="Upload preview"
      className="stack"
      style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 6 }}
    >
      <h3 style={{ margin: 0 }}>Upload preview</h3>
      <p>
        {table.rows.length} rows · Delimiter: {delimiterName(table.delimiter)}
      </p>
      {table.errors.length > 0 && (
        <ul className="cell-error">
          {table.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <table className="data" aria-label="First rows">
        <thead>
          <tr>
            {table.fields.map((f) => (
              <th key={f} scope="col">
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, 5).map((row, i) => (
            <tr key={i}>
              {table.fields.map((f) => (
                <td key={f}>{row[f]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <MappingStep
        programId={props.programId}
        headers={table.fields}
        columns={props.columns}
        mapping={mapping}
        onChange={setMapping}
        presetName={presetName}
        onPresetName={setPresetName}
      />
      <div className="toolbar">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void props.onApply({ rows: applyMapping(table.rows, mapping), mapping, presetName })}
        >
          Apply
        </button>
      </div>
    </section>
  );
}

/** "Paste TSV block": copy cells from a spreadsheet, map the columns, apply (AG Grid Community has no range paste). */
export function PasteDialog({
  open,
  onClose,
  ...props
}: CommonProps & { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [presetName, setPresetName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const reset = () => {
    setTable(null);
    setText('');
    setPresetName('');
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };
  let body: ReactNode;
  if (!table) {
    body = (
      <>
        <Field label="TSV block" hint="Include the header row. Tab-separated, as copied from a spreadsheet.">
          {(id) => (
            <textarea id={id} rows={10} cols={70} value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </Field>
        <div className="toolbar">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!text.trim()}
            onClick={() =>
              void parseInWorker(text).then((parsed) => {
                setTable(parsed);
                setMapping(guessMapping(parsed.fields, props.columns));
              }, setError)
            }
          >
            Next
          </button>
        </div>
      </>
    );
  } else {
    const rows = applyMapping(table.rows, mapping);
    body = (
      <>
        <p>
          {table.rows.length} rows · Delimiter: {delimiterName(table.delimiter)}
        </p>
        <MappingStep
          programId={props.programId}
          headers={table.fields}
          columns={props.columns}
          mapping={mapping}
          onChange={setMapping}
          presetName={presetName}
          onPresetName={setPresetName}
        />
        <div className="toolbar">
          <button type="button" onClick={() => setTable(null)}>
            Back
          </button>
          <button
            type="button"
            className="primary"
            onClick={() =>
              void Promise.resolve(props.onApply({ rows, mapping, presetName })).then(close, setError)
            }
          >
            Apply {rows.length} rows
          </button>
        </div>
      </>
    );
  }
  return (
    <Dialog title="Paste TSV block" open={open} onClose={close}>
      <div className="stack">
        {body}
        <ErrorMessage error={error} />
      </div>
    </Dialog>
  );
}
