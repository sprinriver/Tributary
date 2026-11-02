import type { ExportFormat, QueryResult } from '@tributary/contracts';
import { AllCommunityModule, ModuleRegistry, type ColDef, type SortChangedEvent } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo } from 'react';
import { POPOVER_STYLE, usePopover } from '../components/popover.ts';
import { ErrorMessage } from '../components/ui.tsx';

ModuleRegistry.registerModules([AllCommunityModule]);

type Row = Record<string, unknown>;
export interface Sort {
  column: string;
  dir: 'asc' | 'desc';
}

/** Display only: p-values and tiny numbers in scientific notation, other doubles to 4 significant digits. */
export function formatValue(name: string, type: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'number' && type === 'double') {
    if (value === 0) return '0';
    if (/p_value|q_value|fdr/.test(name) || Math.abs(value) < 1e-3) return value.toExponential(2);
    return Number(value.toPrecision(4)).toString();
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function Menu({ label, items }: { label: string; items: { label: string; onSelect: () => void }[] }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div role="menu" style={{ ...POPOVER_STYLE, left: 0, right: 'auto' }}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColumnChooser({
  all,
  shown,
  onChange,
}: {
  all: string[];
  shown: string[];
  onChange: (cols: string[]) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        Columns
      </button>
      {open && (
        <fieldset style={{ ...POPOVER_STYLE, left: 0, right: 'auto', maxHeight: 320, overflow: 'auto' }}>
          <legend>Columns shown</legend>
          {all.map((name) => (
            <label key={name} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={shown.includes(name)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? all.filter((n) => n === name || shown.includes(n))
                      : shown.filter((n) => n !== name),
                  )
                }
              />{' '}
              {name}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

export function ResultsGrid({
  result,
  error,
  loading,
  page,
  sort,
  allColumns,
  onSort,
  onNext,
  onPrevious,
  onColumns,
  onExport,
  exported,
}: {
  result: QueryResult | undefined;
  error: unknown;
  loading: boolean;
  page: number;
  sort: Sort | undefined;
  allColumns: string[];
  onSort: (sort: Sort | undefined) => void;
  onNext: () => void;
  onPrevious: () => void;
  onColumns: (cols: string[]) => void;
  onExport: (format: ExportFormat) => void;
  exported: { format: ExportFormat; url: string } | { format: ExportFormat; pending: true } | undefined;
}) {
  const columns = useMemo(() => result?.columns ?? [], [result]);
  const colDefs = useMemo<ColDef<Row>[]>(
    () =>
      columns.map((c, i) => ({
        colId: c.name,
        // The first column (usually the identifier) stays visible while scrolling sideways.
        ...(i === 0 ? { pinned: 'left' as const } : {}),
        headerName: c.name,
        // Column names may contain dots (alias.column); read the key directly instead of a nested path.
        valueGetter: (p) => p.data?.[c.name],
        valueFormatter: (p) => formatValue(c.name, c.type, p.value),
        // Rows arrive sorted by the server; the header only changes the requested order.
        comparator: () => 0,
        sort: sort?.column === c.name ? sort.dir : null,
        ...(c.type === 'double' || c.type === 'integer' ? { type: 'rightAligned' } : {}),
      })),
    [columns, sort],
  );
  const pageSize = 25;
  const pages = result ? Math.max(1, Math.ceil(result.totalRows / pageSize)) : 0;

  const sortChanged = (e: SortChangedEvent<Row>) => {
    const sorted = e.api.getColumnState().find((c) => c.sort);
    const next = sorted ? { column: sorted.colId, dir: sorted.sort! } : undefined;
    if (next?.column !== sort?.column || next?.dir !== sort?.dir) onSort(next);
  };

  return (
    <section role="region" aria-label="Results" className="stack">
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <ErrorMessage error={error} />
        {result && (
          <span>
            <strong>
              {result.totalRows.toLocaleString('en')}
              {result.totalCapped ? '+' : ''} rows
            </strong>
            {sort && ` · sorted by ${sort.column} ${sort.dir === 'asc' ? 'ascending' : 'descending'}`} · Page{' '}
            {page} of {pages} · {result.elapsedMs} ms
          </span>
        )}
        {loading && <span role="status">Loading…</span>}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onPrevious} disabled={page <= 1 || loading}>
          Previous page
        </button>
        <button type="button" onClick={onNext} disabled={!result?.nextCursor || loading}>
          Next page
        </button>
        <ColumnChooser all={allColumns} shown={columns.map((c) => c.name)} onChange={onColumns} />
        <Menu
          label="Export"
          items={(['csv', 'tsv', 'parquet'] as const).map((f) => ({
            label: f.toUpperCase(),
            onSelect: () => onExport(f),
          }))}
        />
        {exported &&
          ('url' in exported ? (
            <a href={exported.url} download>
              Download {exported.format.toUpperCase()}
            </a>
          ) : (
            <span role="status">Exporting…</span>
          ))}
      </div>
      {/* Pages are 25 rows: the grid takes their height instead of scrolling inside the page.
          Before the first query there are no columns: a header row without column headers is invalid ARIA. */}
      {colDefs.length === 0 ? (
        <p className="muted">Run a query to see rows.</p>
      ) : (
        <div>
          <AgGridReact<Row>
            rowData={result?.rows ?? []}
            columnDefs={colDefs}
            onSortChanged={sortChanged}
            defaultColDef={{ resizable: true, sortable: true, minWidth: 110 }}
            suppressMultiSort
            enableCellTextSelection
            // Every column in the DOM: wide joined results stay readable by assistive tech and searchable.
            suppressColumnVirtualisation
            domLayout="autoHeight"
          />
        </div>
      )}
    </section>
  );
}
