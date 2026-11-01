import {
  CHART_PALETTES,
  CHART_REGISTRY,
  validateChartSpec,
  type ChartProvenance,
  type ChartRender,
  type ChartSpec,
  type ColumnType,
  type QuerySpec,
} from '@tributary/contracts';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { Dialog, ErrorMessage, Field } from '../components/ui.tsx';
import { AVAILABLE_TYPES, ChartForm, newDraft, type ChartDraft } from './ChartForm.tsx';
import { PlotlyFigure, type SelectedPoint } from './PlotlyFigure.tsx';

type Layout = ChartSpec['layout'];
const LAYOUT: Layout = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};
const LAYOUT_TOGGLES: [keyof Layout, string][] = [
  ['gridX', 'Grid lines X'],
  ['gridY', 'Grid lines Y'],
  ['sharedX', 'Shared X axes'],
  ['sharedY', 'Shared Y axes'],
  ['sharedLegend', 'Shared legend'],
];

/** v1 layout options: palette, grid lines, shared axes across panels, one legend for all panels. */
function LayoutOptions({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  return (
    <details>
      <summary>Layout options</summary>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Palette">
          {(id) => (
            <select
              id={id}
              value={value.palette}
              onChange={(e) => onChange({ ...value, palette: e.target.value })}
            >
              {CHART_PALETTES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </Field>
        {LAYOUT_TOGGLES.map(([key, label]) => (
          <label key={key} className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={value[key] === true}
              onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}

function toSpec(draft: ChartDraft, data: QuerySpec, layout: Layout): ChartSpec {
  const { page: _page, ...query } = data;
  const axes = {
    ...(draft.xTitle ? { x: { title: draft.xTitle } } : {}),
    ...(draft.yTitle ? { y: { title: draft.yTitle } } : {}),
  };
  return {
    type: draft.type,
    data: query,
    encodings: draft.encodings,
    options: draft.options,
    ...(Object.keys(axes).length ? { axes } : {}),
    layout,
  } as ChartSpec;
}

function ProvenanceDialog({ provenance, onClose }: { provenance: ChartProvenance; onClose: () => void }) {
  return (
    <Dialog title="Chart provenance" open onClose={onClose}>
      <dl className="stack" style={{ minWidth: 'min(640px, 90vw)' }}>
        <dt>Dataset releases</dt>
        <dd>
          {provenance.release_ids.length
            ? provenance.release_ids.map((id) => <code key={id}>{id} </code>)
            : 'metadata tables only'}
        </dd>
        <dt>Query hash</dt>
        <dd>
          <code>{provenance.sql_hash}</code>
        </dd>
        <dt>Rows</dt>
        <dd>
          {provenance.rows} plotted
          {provenance.dropped_rows > 0 &&
            `; ${provenance.dropped_rows} dropped (missing values, chart null policy)`}
        </dd>
        <dt>Transformations</dt>
        <dd>{provenance.transformations.length ? provenance.transformations.join('; ') : 'none'}</dd>
        <dt>Compute</dt>
        <dd>
          {Object.keys(provenance.compute).length
            ? Object.entries(provenance.compute)
                .map(([k, v]) => `${k}: ${v}`)
                .join('; ')
            : 'no server statistics (display transforms only)'}
        </dd>
        <dt>Rendered</dt>
        <dd>{new Date(provenance.rendered_at).toLocaleString()}</dd>
        <dt>Chart spec</dt>
        <dd>
          <pre style={{ maxHeight: 240, overflow: 'auto', background: 'var(--surface-2)', padding: 8 }}>
            {JSON.stringify(provenance.chart_spec, null, 2)}
          </pre>
        </dd>
      </dl>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </Dialog>
  );
}

/** Numbers to 4 significant digits; labels (categorical axes) as they are. */
const cell = (v: unknown) => (typeof v === 'number' ? Number(v.toPrecision(4)) : String(v ?? ''));

/** Table alternative for the drawn chart (web UI rule): points of scatter traces, or the heatmap matrix. */
function FigureTable({ render }: { render: ChartRender }) {
  const traces = render.figure.data as Record<string, unknown>[];
  const heat = traces.find((t) => t.type === 'heatmap');
  if (heat) {
    const x = heat.x as string[];
    const y = heat.y as string[];
    const z = heat.z as (number | null)[][];
    return (
      <table aria-label="Chart data" className="data-table">
        <thead>
          <tr>
            <th scope="col">row</th>
            {x.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {y.slice(0, 500).map((r, i) => (
            <tr key={r}>
              <th scope="row">{r}</th>
              {z[i]!.map((v, j) => (
                <td key={j}>{v === null ? '' : Number(v.toPrecision(4))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const points = traces
    .filter((t) => typeof t.mode === 'string' && t.mode.includes('markers') && Array.isArray(t.x))
    .flatMap((t) =>
      (t.x as unknown[]).map((x, i) => ({
        group: String(t.name),
        x,
        y: (t.y as unknown[] | undefined)?.[i],
        label: ((t.customdata as unknown[][] | undefined)?.[i]?.[0] as string | null) ?? '',
      })),
    );
  return (
    <table aria-label="Chart data" className="data-table">
      <thead>
        <tr>
          <th scope="col">label</th>
          <th scope="col">group</th>
          <th scope="col">x</th>
          <th scope="col">y</th>
        </tr>
      </thead>
      <tbody>
        {points.slice(0, 500).map((p, i) => (
          <tr key={i}>
            <td>{p.label}</td>
            <td>{p.group}</td>
            <td>{cell(p.x)}</td>
            <td>{cell(p.y)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** SPEC M7 charts over the Data Explorer's current query: registry form → /v1/charts/render → Plotly. */
export function ChartPanel({ data, columns }: { data: QuerySpec; columns: Record<string, ColumnType> }) {
  const [draft, setDraft] = useState<ChartDraft>(() => newDraft('volcano'));
  const [layout, setLayout] = useState<Layout>(LAYOUT);
  const [selected, setSelected] = useState<SelectedPoint[]>([]);
  const [showProvenance, setShowProvenance] = useState(false);
  const download = useRef<(format: 'png' | 'svg') => void>(undefined);
  const spec = useMemo(() => toSpec(draft, data, layout), [draft, data, layout]);
  const clientErrors = useMemo(() => validateChartSpec(spec, columns), [spec, columns]);
  const render = useMutation({
    mutationFn: () => api('renderChart', { body: { spec } }),
    onSuccess: () => setSelected([]),
  });
  // Server field errors (data rules) join the client ones next to the controls.
  const serverError = render.error instanceof ApiError ? render.error.body : undefined;
  const errors = Object.fromEntries([
    ...clientErrors.map((e) => [e.field ?? '', e.message]),
    ...(serverError?.field ? [[serverError.field, serverError.message]] : []),
    ...((serverError?.errors ?? []).map((e) => [e.field ?? '', e.message]) as [string, string][]),
  ]);
  const onSelected = useCallback((points: SelectedPoint[]) => setSelected(points), []);
  const onReady = useCallback((fn: (format: 'png' | 'svg') => void) => {
    download.current = fn;
  }, []);
  const label = `${CHART_REGISTRY[draft.type]!.label} chart`;

  return (
    <section role="region" aria-label="Chart" className="card stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Chart</h2>
      <Field label="Chart type">
        {(id) => (
          <select
            id={id}
            value={draft.type}
            onChange={(e) => setDraft(newDraft(e.target.value as ChartDraft['type']))}
          >
            {AVAILABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {CHART_REGISTRY[t]!.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <ChartForm draft={draft} columns={columns} errors={errors} onChange={setDraft} />
      <LayoutOptions value={layout} onChange={setLayout} />
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={clientErrors.length > 0 || render.isPending}
          onClick={() => render.mutate()}
        >
          {render.isPending ? 'Drawing…' : 'Apply'}
        </button>
        {render.data && (
          <>
            <button type="button" onClick={() => setShowProvenance(true)}>
              Provenance
            </button>
            <button type="button" onClick={() => download.current?.('png')}>
              Download PNG
            </button>
            <button type="button" onClick={() => download.current?.('svg')}>
              Download SVG
            </button>
            <span>
              {render.data.provenance.rows} rows plotted
              {render.data.provenance.dropped_rows > 0 &&
                ` · ${render.data.provenance.dropped_rows} dropped (missing values)`}
            </span>
          </>
        )}
      </div>
      {render.error && !serverError?.field && <ErrorMessage error={render.error} />}
      {render.data && (
        <>
          <PlotlyFigure label={label} figure={render.data.figure} onSelected={onSelected} onReady={onReady} />
          {selected.length > 0 && (
            <table aria-label="Selected points" className="data-table">
              <thead>
                <tr>
                  <th scope="col">label</th>
                  <th scope="col">x</th>
                  <th scope="col">y</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((p, i) => (
                  <tr key={i}>
                    <td>{String(p.customdata?.[0] ?? '')}</td>
                    <td>{String(p.x)}</td>
                    <td>{String(p.y)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details>
            <summary>Data table</summary>
            <FigureTable render={render.data} />
          </details>
        </>
      )}
      {showProvenance && render.data && (
        <ProvenanceDialog provenance={render.data.provenance} onClose={() => setShowProvenance(false)} />
      )}
    </section>
  );
}
