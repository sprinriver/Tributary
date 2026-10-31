import {
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

const LAYOUT = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};

function toSpec(draft: ChartDraft, data: QuerySpec): ChartSpec {
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
    layout: LAYOUT,
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
          <pre style={{ maxHeight: 240, overflow: 'auto', background: '#f6f8fa', padding: 8 }}>
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
    .filter((t) => t.mode === 'markers')
    .flatMap((t) =>
      (t.x as number[]).map((x, i) => ({
        group: String(t.name),
        x,
        y: (t.y as number[])[i]!,
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
            <td>{Number(p.x.toPrecision(4))}</td>
            <td>{Number(p.y.toPrecision(4))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** SPEC M7 charts over the Data Explorer's current query: registry form → /v1/charts/render → Plotly. */
export function ChartPanel({ data, columns }: { data: QuerySpec; columns: Record<string, ColumnType> }) {
  const [draft, setDraft] = useState<ChartDraft>(() => newDraft('volcano'));
  const [selected, setSelected] = useState<SelectedPoint[]>([]);
  const [showProvenance, setShowProvenance] = useState(false);
  const download = useRef<(format: 'png' | 'svg') => void>(undefined);
  const spec = useMemo(() => toSpec(draft, data), [draft, data]);
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
