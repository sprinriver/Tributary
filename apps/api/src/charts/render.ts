import {
  CHART_REGISTRY,
  ChartRenderSchema,
  ClusterResultSchema,
  QueryResultSchema,
  validateChartSpec,
  type ChartRender,
  type ChartSpec,
  type DendrogramOptions,
  type HeatmapOptions,
  type QuerySpec,
  type VolcanoOptions,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError, notFound } from '../errors.ts';
import { columnTypes, prepare, releaseIds } from '../query/prepare.ts';
import { visibleView } from '../routes/views.ts';
import { dataError } from './errors.ts';
import { shapeDendrogram, shapeHeatmap } from './figures.ts';
import type { Cluster } from './matrix.ts';
import { shapeVolcano, type Shaped } from './volcano.ts';

export interface ChartDeps {
  db: Database;
  config: ApiConfig;
  fetch: typeof fetch;
}

/** Compute fields → the chart control the user changes. */
const COMPUTE_FIELD: Record<string, string> = {
  values: 'encodings.values',
  row_labels: 'encodings.rowLabel',
};

function computeClient(deps: ChartDeps): Cluster {
  return async (body) => {
    let res: Response;
    try {
      res = await deps.fetch(`${deps.config.computeUrl}/stats/cluster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new HttpError(503, 'compute_unavailable', 'The compute service is not reachable.');
    }
    const json = (await res.json().catch(() => ({}))) as { code?: string; field?: string; message?: string };
    if (res.status === 422)
      throw dataError(
        json.code ?? 'compute_failed',
        COMPUTE_FIELD[json.field ?? ''] ?? `options.${json.field}`,
        json.message ?? 'Clustering failed.',
      );
    if (!res.ok)
      throw new HttpError(502, 'compute_failed', `The compute service answered HTTP ${res.status}.`);
    return ClusterResultSchema.parse(json);
  };
}

/** The view's or the inline QuerySpec (a view the caller may not open is "not found"). */
async function querySpecOf(db: Database, request: FastifyRequest, spec: ChartSpec): Promise<QuerySpec> {
  if (!('savedViewId' in spec.data)) return spec.data;
  const view = await visibleView(db, request, spec.data.savedViewId);
  if (!view) throw notFound('View');
  return view.query_spec as QuerySpec;
}

/** ChartSpec → data (scoped, validated) → shaping (+ compute) → Plotly figure with provenance (SPEC M7). */
export async function renderChart(
  deps: ChartDeps,
  request: FastifyRequest,
  spec: ChartSpec,
): Promise<ChartRender> {
  const def = CHART_REGISTRY[spec.type];
  if (!def) throw new HttpError(400, 'not_available', `${spec.type} charts are not available yet.`, 'type');
  const query = await querySpecOf(deps.db, request, spec);
  const sources = await prepare(deps.db, request, query);
  const errors = validateChartSpec(spec, columnTypes(query, sources));
  const [first] = errors;
  if (first) throw new HttpError(400, first.code, first.message, first.field, errors);
  const options = def.options.parse(spec.options) as Record<string, unknown>;

  // Read only the encoded columns, every row up to the chart's point cap (+1 to detect overflow).
  const encoded = [...new Set(Object.values(spec.encodings).flatMap((v) => (Array.isArray(v) ? v : [v])))];
  const cap = def.dataRules.maxPoints ?? 100_000;
  const { page: _page, select: _select, ...rest } = query;
  const internal = { spec: { ...rest, select: encoded }, ...sources, all_rows: cap + 1 };
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', internal),
  );
  if (result.totalRows > cap)
    throw dataError(
      'too_many_points',
      'data',
      `${result.totalRows} rows; this chart draws at most ${cap}. Filter first.`,
    );
  if (result.rows.length < (def.dataRules.minRows ?? 1))
    throw dataError(
      'too_few_rows',
      'data',
      `No rows to plot (needs at least ${def.dataRules.minRows ?? 1}).`,
    );

  let shaped: Shaped;
  if (spec.type === 'volcano') shaped = shapeVolcano(result.rows, spec, options as VolcanoOptions);
  else if (spec.type === 'heatmap')
    shaped = await shapeHeatmap(result.rows, spec, options as HeatmapOptions, computeClient(deps));
  else shaped = await shapeDendrogram(result.rows, spec, options as DendrogramOptions, computeClient(deps));

  return ChartRenderSchema.parse({
    figure: { data: shaped.data, layout: shaped.layout },
    provenance: {
      release_ids: releaseIds({ spec: query, ...sources }),
      sql_hash: result.sqlHash,
      chart_spec: { ...spec, options },
      rows: shaped.rows,
      dropped_rows: shaped.dropped,
      compute: shaped.compute,
      transformations: shaped.transformations,
      rendered_at: new Date().toISOString(),
    },
  });
}
