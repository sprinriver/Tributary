import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MetadataFieldDef, SeedTerm, VersionDetail } from '@tributary/contracts';
import { AllCommunityModule, ModuleRegistry, type GridApi } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { AddColumnDialog, SampleColumnChips } from './AddColumnDialog.tsx';
import { useSamples } from '../registry/queries.ts';
import { parseTsv } from '../registry/tsv.ts';
import { PasteDialog, UploadPreview, type ApplyArgs } from './ImportPanels.tsx';
import { mergeBySampleKey } from './mapping.ts';
import { buildColumnDefs, type Row } from './columns.ts';
import { CurationDialog } from './CurationDialog.tsx';
import { EditToolbar, applyCuration, curationTargets as targetsOf } from './EditToolbar.tsx';
import type { ParsedTable } from './parse-core.ts';
import { parseInWorker } from './parse.ts';
import { PlateView } from './PlateView.tsx';
import { downloadVersionSdrf } from './sdrf.ts';
import { validateRows } from './validation.ts';

ModuleRegistry.registerModules([AllCommunityModule]);

let counter = 0;
const newRow = (cells: Record<string, string> = {}): Row => ({
  id: `row-${Date.now().toString(36)}-${counter++}`,
  cells,
});
/** Columns shown even when empty (with required fields); others appear once they hold data (or with "All columns"). */
const CORE = [
  'sample_key',
  'source_name',
  'organism',
  'cell_line',
  'compound_id',
  'dose',
  'time',
  'condition',
  'replicate_group',
  'well',
  'raw_file',
];

export function ManifestEditor({ version, readOnly }: { version: VersionDetail; readOnly: boolean }) {
  const client = useQueryClient();
  const samples = useSamples(version.id);
  const templates = useQuery({
    queryKey: ['templates', version.assay_type],
    queryFn: () => api('listTemplates', { query: { assay_type: version.assay_type } }),
  });
  const template =
    templates.data?.items.find((t) => t.version === version.template_version) ?? templates.data?.items[0];

  const [rows, setRows] = useState<Row[]>([]);
  const [loadedFrom, setLoadedFrom] = useState<unknown>(null);
  const [sampleFields, setSampleFields] = useState<MetadataFieldDef[]>([]);
  const [extraTerms, setExtraTerms] = useState<SeedTerm[]>([]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [allColumns, setAllColumns] = useState(false);
  const [quickPaste, setQuickPaste] = useState('');
  const [upload, setUpload] = useState<ParsedTable | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [columnOpen, setColumnOpen] = useState(false);
  const [plateOpen, setPlateOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const gridApi = useRef<GridApi<Row> | null>(null);

  // Load server rows once per fetch (and again after save/import refetches).
  if (samples.data && samples.data !== loadedFrom) {
    setLoadedFrom(samples.data);
    // Keep row ids stable across reloads (matched by sample key) so the grid updates rows in place.
    const idByKey = new Map(rows.map((r) => [r.cells.sample_key?.trim(), r.id]));
    setRows(samples.data.items.map((s) => ({ id: idByKey.get(s.sample_key) ?? s.id, cells: { ...s.raw } })));
    setSampleFields(version.custom_fields.filter((f) => f.scope === 'sample'));
  }

  const validation = useMemo(
    () =>
      template
        ? validateRows(
            template,
            sampleFields,
            rows.map((r) => r.cells),
            extraTerms,
          )
        : { errors: new Map(), count: 0 },
    [template, sampleFields, rows, extraTerms],
  );
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const [curationOpen, setCurationOpen] = useState(false);
  const errorAt = useCallback(
    (id: string, column: string) => validation.errors.get(rowIndex.get(id) ?? -1)?.[column],
    [validation, rowIndex],
  );
  // The grid reads its external filter through refs; sync them, then refresh cell classes and the filter.
  const problemRows = useRef<Set<string>>(new Set());
  const onlyProblemsRef = useRef(onlyProblems);
  useEffect(() => {
    problemRows.current = new Set(
      rows.filter((r) => validation.errors.has(rowIndex.get(r.id) ?? -1)).map((r) => r.id),
    );
    onlyProblemsRef.current = onlyProblems;
    gridApi.current?.refreshCells({ force: true });
    gridApi.current?.onFilterChanged();
  }, [rows, rowIndex, validation, onlyProblems]);

  const fieldDefs = useMemo(
    () => [...(template?.fields.filter((f) => f.scope === 'sample') ?? []), ...sampleFields],
    [template, sampleFields],
  );
  const allKeys = fieldDefs.map((f) => f.key);
  const curationTargets = useMemo(
    () => (curationOpen ? targetsOf(fieldDefs, rows, validation.errors) : []),
    [curationOpen, fieldDefs, rows, validation.errors],
  );

  const visible = allKeys.filter(
    (k) =>
      allColumns ||
      CORE.includes(k) ||
      // Required fields always have a column (e.g. one a newer template version added), so they can be filled.
      fieldDefs.some((f) => f.key === k && f.required) ||
      sampleFields.some((f) => f.key === k) ||
      rows.some((r) => r.cells[k]),
  );

  // A stable key for the visible column set, so column definitions are rebuilt only when it changes.
  const visibleKey = visible.join('|');

  const setCell = useCallback((id: string, key: string, value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, cells: { ...r.cells, [key]: value } } : r)));
  }, []);
  const pickTerm = useCallback(
    (ontology: string) => (term: { id: string; label: string }) =>
      setExtraTerms((t) => [...t, { ontology, ...term }]),
    [],
  );

  const columnDefs = useMemo(
    () => buildColumnDefs({ visible, fieldDefs, readOnly, setCell, errorAt, pickTerm }),
    [visibleKey, fieldDefs, readOnly, setCell, errorAt, pickTerm], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const columnsForMapping = allKeys;
  const programId = version.program_id;

  function applyImported({ rows: incoming, mapping, presetName }: ApplyArgs) {
    setRows((prev) => mergeBySampleKey(prev, incoming, newRow));
    setUpload(null);
    setMessage(`Applied ${incoming.length} imported rows`);
    if (presetName.trim()) {
      // The rows are applied at once; the preset is saved in the background and a failure is reported here.
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
      void api('createMappingPreset', {
        params: { id: programId },
        body: { name: presetName.trim(), mapping: clean },
      })
        .then(() => client.invalidateQueries({ queryKey: ['mapping-presets', programId] }))
        .catch((e: unknown) =>
          setMessage(
            `Applied ${incoming.length} imported rows; the mapping preset was not saved: ${String(e)}`,
          ),
        );
    }
  }

  async function refetchAll() {
    await Promise.all(
      ['samples', 'version', 'experiment', 'diff'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      let current = rows;
      if (quickPaste.trim()) {
        current = mergeBySampleKey(current, parseTsv(quickPaste), newRow);
        setRows(current);
        setQuickPaste('');
      }
      const serverFields = version.custom_fields.filter((f) => f.scope === 'sample');
      if (JSON.stringify(serverFields) !== JSON.stringify(sampleFields)) {
        await api('updateVersion', {
          params: { id: version.id },
          reason: 'Sample columns',
          body: {
            custom_fields: [
              ...version.custom_fields.filter((f) => f.scope === 'experiment'),
              ...sampleFields,
            ],
          },
        });
      }
      const keys = new Set(current.map((r) => r.cells.sample_key?.trim()).filter(Boolean));
      const removed = (samples.data?.items ?? []).map((s) => s.sample_key).filter((k) => !keys.has(k));
      if (removed.length)
        await api('deleteSamples', {
          params: { id: version.id },
          body: { sample_keys: removed },
          reason: 'Manifest edit',
        });
      const withKeys = current.filter((r) => r.cells.sample_key?.trim()).map((r) => r.cells);
      const result = withKeys.length
        ? await api('upsertSamples', {
            params: { id: version.id },
            body: { rows: withKeys },
            reason: 'Manifest edit',
          })
        : { saved: 0, errors: [] };
      setMessage(`${result.saved} samples saved`);
      await refetchAll();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function downloadSdrf() {
    setError(null);
    await downloadVersionSdrf(version.id).catch(setError);
  }

  async function importSdrf(file: File) {
    setBusy(true);
    setError(null);
    try {
      await api('importSdrf', {
        params: { id: version.id },
        body: { sdrf: await file.text() },
        reason: 'SDRF import',
      });
      const fresh = await client.fetchQuery({
        queryKey: ['samples', version.id],
        queryFn: () => api('listSamples', { params: { id: version.id } }),
      });
      setMessage(`${fresh.items.length} samples saved`);
      await refetchAll();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!template || !samples.data) return <p>Loading…</p>;
  return (
    <div className="stack">
      {!readOnly && (
        <EditToolbar
          onUpload={(file) => void file.text().then(parseInWorker).then(setUpload, setError)}
          onPaste={() => setPasteOpen(true)}
          onAddRow={() => setRows((r) => [...r, newRow()])}
          onDeleteRow={() => {
            const focused = gridApi.current?.getFocusedCell();
            const node = focused ? gridApi.current?.getDisplayedRowAtIndex(focused.rowIndex) : undefined;
            if (node?.data) setRows((r) => r.filter((x) => x.id !== node.data!.id));
          }}
          onAddColumn={() => setColumnOpen(true)}
          onSuggest={() => setCurationOpen(true)}
          onSave={() => void save()}
          busy={busy}
        />
      )}
      <div className="toolbar">
        <button type="button" aria-pressed={plateOpen} onClick={() => setPlateOpen((v) => !v)}>
          Plate layout
        </button>
        <button type="button" onClick={() => void downloadSdrf()}>
          Download SDRF
        </button>
        {!readOnly && (
          <label className="button">
            Import SDRF
            <input
              type="file"
              aria-label="Import SDRF"
              accept=".tsv,.txt"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void importSdrf(file);
              }}
            />
          </label>
        )}
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
          Only rows with problems
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} />
          All columns
        </label>
        <span aria-live="polite" className={validation.count ? 'cell-error' : 'muted'}>
          {validation.count ? `${validation.count} problems` : 'No problems'}
        </span>
        <span className="muted">{rows.length} rows</span>
      </div>
      <SampleColumnChips
        fields={sampleFields}
        readOnly={readOnly}
        onRemove={(key) => setSampleFields((s) => s.filter((x) => x.key !== key))}
      />
      <ErrorMessage error={error} />
      {message && <p aria-live="polite">{message}</p>}
      {upload && (
        <UploadPreview
          table={upload}
          programId={programId}
          columns={columnsForMapping}
          onApply={applyImported}
          onCancel={() => setUpload(null)}
        />
      )}
      {plateOpen && (
        <PlateView
          rows={rows}
          onSelect={(id) => {
            const node = gridApi.current?.getRowNode(id);
            if (node && node.rowIndex !== null) {
              gridApi.current?.ensureNodeVisible(node);
              gridApi.current?.setFocusedCell(node.rowIndex, 'sample_key');
            }
          }}
        />
      )}
      <div style={{ height: 460 }}>
        <AgGridReact<Row>
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.id}
          defaultColDef={{ resizable: true, sortable: true }}
          suppressColumnVirtualisation
          animateRows={false}
          stopEditingWhenCellsLoseFocus
          tooltipShowDelay={200}
          isExternalFilterPresent={() => onlyProblemsRef.current}
          doesExternalFilterPass={(node) => !!node.data && problemRows.current.has(node.data.id)}
          onGridReady={(e) => {
            gridApi.current = e.api;
          }}
        />
      </div>
      {!readOnly && (
        <Field
          label="Paste TSV"
          hint="Quick add: a header row of column names, then rows. Saved with “Save samples”."
        >
          {(id) => (
            <textarea id={id} rows={4} value={quickPaste} onChange={(e) => setQuickPaste(e.target.value)} />
          )}
        </Field>
      )}
      <PasteDialog
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        programId={programId}
        columns={columnsForMapping}
        onApply={applyImported}
      />
      {curationOpen && (
        <CurationDialog
          targets={curationTargets}
          onClose={() => setCurationOpen(false)}
          onApply={(changes) => {
            setRows((prev) => applyCuration(prev, changes));
            setMessage(
              `Applied ${changes.length} ontology term${changes.length > 1 ? 's' : ''}; save to keep them`,
            );
            setCurationOpen(false);
          }}
        />
      )}
      <AddColumnDialog
        open={columnOpen}
        onClose={() => setColumnOpen(false)}
        taken={allKeys}
        onAdd={(field) => {
          setSampleFields((s) => [...s, field]);
          setColumnOpen(false);
        }}
      />
    </div>
  );
}
