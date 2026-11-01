import type { LineageGraph, LineageKind, LineageGraphNode } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage, Field } from '../components/ui.tsx';

export interface LineageSearch {
  depth?: number | undefined;
  direction?: 'upstream' | 'downstream' | 'both' | undefined;
}

export const KIND_LABEL: Record<LineageKind, string> = {
  file: 'File',
  pipeline_run: 'Pipeline run',
  experiment_version: 'Experiment version',
  dataset_release: 'Release',
  chart: 'Saved chart',
};
const KIND_COLOUR: Record<LineageKind, string> = {
  file: '#57606a',
  pipeline_run: '#8250df',
  experiment_version: '#0969da',
  dataset_release: '#1a7f37',
  chart: '#bc4c00',
};
const W = 220;
const H = 58;
const GAP_X = 70;
const GAP_Y = 18;
const nodeKey = (n: { kind: string; id: string }) => `${n.kind}:${n.id}`;

/** Columns by step from the entity (upstream left, downstream right); deterministic order within a column. */
export function layout(graph: LineageGraph) {
  const depths = graph.nodes.map((n) => n.depth);
  const min = Math.min(0, ...depths);
  const columns = new Map<number, LineageGraphNode[]>();
  for (const n of [...graph.nodes].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label),
  ))
    columns.set(n.depth, [...(columns.get(n.depth) ?? []), n]);
  const pos = new Map<string, { x: number; y: number }>();
  for (const [depth, nodes] of columns)
    nodes.forEach((n, i) => pos.set(nodeKey(n), { x: (depth - min) * (W + GAP_X), y: i * (H + GAP_Y) }));
  const width = (Math.max(0, ...depths) - min + 1) * (W + GAP_X) - GAP_X;
  const height = Math.max(...[...columns.values()].map((c) => c.length)) * (H + GAP_Y) - GAP_Y;
  return { pos, width, height };
}

/** Where a node's own page is, if it has one. */
function entityLink(n: LineageGraphNode) {
  if (n.kind === 'dataset_release')
    return (
      <Link to="/releases/$id" params={{ id: n.id }}>
        Open
      </Link>
    );
  if (n.kind === 'pipeline_run')
    return (
      <Link to="/runs/$id" params={{ id: n.id }}>
        Open
      </Link>
    );
  return null;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function LineagePage() {
  return (
    <RequireAuth>
      <Lineage />
    </RequireAuth>
  );
}

function Lineage() {
  const { kind, id } = useParams({ from: '/lineage/$kind/$id' });
  const search = useSearch({ from: '/lineage/$kind/$id' });
  const navigate = useNavigate({ from: '/lineage/$kind/$id' });
  const depth = search.depth ?? 3;
  const direction = search.direction ?? 'both';
  const graph = useQuery({
    queryKey: ['lineage', kind, id, depth, direction],
    queryFn: () => api('getLineage', { query: { kind: kind as LineageKind, id, depth, direction } }),
  });
  const g = graph.data;
  const root = g?.nodes.find((n) => n.depth === 0);
  const centre = (n: LineageGraphNode) =>
    void navigate({ to: '/lineage/$kind/$id', params: { kind: n.kind, id: n.id }, search });

  return (
    <main className="stack">
      <h1>Lineage{root ? ` — ${root.label}` : ''}</h1>
      <p style={{ margin: 0, color: '#57606a' }}>
        Upstream (inputs) on the left, downstream (what was made from it) on the right. Select a node to
        centre on it.
      </p>
      <div className="row">
        <Field label="Depth">
          {(fid) => (
            <select
              id={fid}
              value={depth}
              onChange={(e) => void navigate({ search: { ...search, depth: Number(e.target.value) } })}
            >
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Direction">
          {(fid) => (
            <select
              id={fid}
              value={direction}
              onChange={(e) =>
                void navigate({
                  search: { ...search, direction: e.target.value as LineageSearch['direction'] },
                })
              }
            >
              <option value="both">Upstream and downstream</option>
              <option value="upstream">Upstream only</option>
              <option value="downstream">Downstream only</option>
            </select>
          )}
        </Field>
      </div>
      <ErrorMessage error={graph.error} />
      {g && (
        <>
          {g.truncated && (
            <p role="status">Showing the first {g.nodes.length} nodes; reduce the depth to see all.</p>
          )}
          <Graph graph={g} onSelect={centre} />
          <NodeTable graph={g} onSelect={centre} />
        </>
      )}
    </main>
  );
}

function Graph({ graph, onSelect }: { graph: LineageGraph; onSelect: (n: LineageGraphNode) => void }) {
  const { pos, width, height } = layout(graph);
  const root = graph.nodes.find((n) => n.depth === 0);
  return (
    <figure
      aria-label={`Lineage graph of ${root?.label ?? 'the entity'}`}
      className="card"
      style={{ margin: 0, overflowX: 'auto', padding: 12 }}
    >
      <svg width={width + 4} height={height + 4} role="presentation" style={{ display: 'block' }}>
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#8c959f" />
          </marker>
        </defs>
        {graph.edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x;
          const y2 = b.y + H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path
              key={`${e.from}-${e.to}-${e.relation}`}
              d={`M${x1 + 2},${y1 + 2} C${mid},${y1 + 2} ${mid},${y2 + 2} ${x2 + 2},${y2 + 2}`}
              fill="none"
              stroke="#8c959f"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            >
              <title>{e.relation.replace('_', ' ')}</title>
            </path>
          );
        })}
        {graph.nodes.map((n) => {
          const p = pos.get(nodeKey(n))!;
          return (
            <g
              key={nodeKey(n)}
              transform={`translate(${p.x + 2},${p.y + 2})`}
              onClick={() => onSelect(n)}
              style={{ cursor: 'pointer' }}
            >
              <rect
                width={W}
                height={H}
                rx={6}
                fill={n.depth === 0 ? '#ddf4ff' : '#fff'}
                stroke={KIND_COLOUR[n.kind]}
                strokeWidth={n.depth === 0 ? 2.5 : 1.5}
              />
              <text x={10} y={17} fontSize={11} fill={KIND_COLOUR[n.kind]} fontWeight={600}>
                {KIND_LABEL[n.kind]}
                {n.status ? ` · ${n.status}` : ''}
              </text>
              <text x={10} y={34} fontSize={13} fill="#1f2328">
                {truncate(n.label, 30)}
              </text>
              <text x={10} y={50} fontSize={11} fill="#57606a">
                {truncate(n.detail, 34)}
              </text>
              <title>{`${KIND_LABEL[n.kind]}: ${n.label} — ${n.detail}`}</title>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** The table alternative of the graph (web-ui rule: every chart has one). */
function NodeTable({ graph, onSelect }: { graph: LineageGraph; onSelect: (n: LineageGraphNode) => void }) {
  const rows = [...graph.nodes].sort((a, b) => a.depth - b.depth || a.kind.localeCompare(b.kind));
  return (
    <table className="data" aria-label="Lineage nodes">
      <thead>
        <tr>
          <th scope="col">Steps</th>
          <th scope="col">Kind</th>
          <th scope="col">Name</th>
          <th scope="col">Detail</th>
          <th scope="col">Status</th>
          <th scope="col">Program</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((n) => (
          <tr key={nodeKey(n)}>
            <td>{n.depth === 0 ? 'this' : n.depth < 0 ? `${-n.depth} up` : `${n.depth} down`}</td>
            <td>{KIND_LABEL[n.kind]}</td>
            <td>{n.label}</td>
            <td>{n.detail}</td>
            <td>{n.status ?? '—'}</td>
            <td>{n.program_code ?? '—'}</td>
            <td className="row">
              {entityLink(n)}
              {n.depth !== 0 && (
                <button type="button" onClick={() => onSelect(n)}>
                  Centre
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
