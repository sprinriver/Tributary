import { QueryResultSchema, type QuerySpec } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { prepare } from '../query/prepare.ts';
import { dataError } from '../charts/errors.ts';

const toNum = (v: unknown) =>
  v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;

/** Contrast comparison (SPEC M8): log2 FC per feature per contrast, hits, exclusive intersections, figures. */
export async function compareContrasts(
  deps: { db: Database; config: ApiConfig; fetch: typeof fetch },
  request: FastifyRequest,
  body: {
    contrasts: { release_id: string; contrast_id: string }[];
    fc_threshold: number;
    p_threshold: number;
  },
) {
  type Value = { fc: number | null; p: number | null; gene: string; group: string };
  // Per contrast: accession -> value, matching protein groups on their accessions (CLAUDE.md: split groups for
  // joins). An accession in more than one group of a contrast is ambiguous and left out.
  const series: Map<string, Value | 'ambiguous'>[] = [];
  const labels: string[] = [];
  for (const c of body.contrasts) {
    const spec: QuerySpec = {
      source: { releaseIds: [c.release_id] },
      where: { combinator: 'and', rules: [{ field: 'contrast_id', operator: '=', value: c.contrast_id }] },
      select: ['feature_id', 'protein_ids', 'gene_names', 'log2_fc', 'adj_p_value', 'contrast_label'],
    };
    const sources = await prepare(deps.db, request, spec);
    const cap = 200_000;
    const result = QueryResultSchema.parse(
      await callQueryService(deps.fetch, deps.config, '/internal/query', { spec, ...sources, all_rows: cap }),
    );
    if (result.totalRows > result.rows.length)
      throw dataError(
        'too_many_rows',
        'contrasts',
        `A contrast has ${result.totalRows} rows; comparisons read at most ${cap}.`,
      );
    const name = await deps.db
      .selectFrom('dataset_release as r')
      .innerJoin('dataset as d', 'd.id', 'r.dataset_id')
      .leftJoin('experiment_version as v', 'v.id', 'd.experiment_version_id')
      .leftJoin('experiment as e', 'e.id', 'v.experiment_id')
      .select(['e.name', 'd.name as dataset'])
      .where('r.id', '=', c.release_id)
      .executeTakeFirst();
    labels.push(
      `${name?.name ?? name?.dataset ?? c.release_id} · ${String(result.rows[0]?.contrast_label ?? 'contrast')}`,
    );
    const map = new Map<string, Value | 'ambiguous'>();
    for (const r of result.rows) {
      const ids =
        Array.isArray(r.protein_ids) && r.protein_ids.length
          ? r.protein_ids.map(String)
          : [String(r.feature_id)];
      const value: Value = {
        fc: toNum(r.log2_fc),
        p: toNum(r.adj_p_value),
        gene: Array.isArray(r.gene_names) ? r.gene_names.join(';') : '',
        group: String(r.feature_id),
      };
      for (const id of ids) map.set(id, map.has(id) ? 'ambiguous' : value);
    }
    series.push(map);
  }
  const measured = (v: Value | 'ambiguous' | undefined): v is Value =>
    !!v && v !== 'ambiguous' && v.fc !== null && v.p !== null;
  const hit = (v: Value) => Math.abs(v.fc!) >= body.fc_threshold && v.p! <= body.p_threshold;
  const accessions = [...new Set(series.flatMap((s) => [...s.keys()]))].sort();
  const ambiguous = accessions.filter((a) => series.some((s) => s.get(a) === 'ambiguous')).length;
  // Only accessions measured in every contrast are compared: "not a hit" must mean measured and unchanged.
  const inAll = accessions.filter((a) => series.every((s) => measured(s.get(a))));
  const leftOut = accessions.length - inAll.length - ambiguous;
  const rows = inAll.map((a) => {
    const values = series.map((s) => s.get(a) as Value);
    return {
      feature_id: a,
      gene: values.find((v) => v.gene)?.gene ?? '',
      log2_fc: values.map((v) => v.fc),
      significant: values.map(hit),
      best_p: Math.min(...values.map((v) => v.p!)),
    };
  });
  const overlapAll = rows
    .filter((r) => r.significant.some(Boolean))
    .sort(
      (x, y) =>
        y.significant.filter(Boolean).length - x.significant.filter(Boolean).length || x.best_p - y.best_p,
    );
  const overlap = overlapAll.map(({ best_p: _b, ...r }) => r);
  // Exclusive intersections (UpSet): each hit counts once, in its exact membership pattern.
  const patterns = new Map<string, { members: boolean[]; count: number }>();
  for (const r of overlap) {
    const key = r.significant.map((b) => (b ? 1 : 0)).join('');
    patterns.set(key, { members: r.significant, count: (patterns.get(key)?.count ?? 0) + 1 });
  }
  const intersections = [...patterns.values()].sort(
    (a, b) => b.count - a.count || a.members.join().localeCompare(b.members.join()),
  );

  const shared = rows;
  const bothHit = shared.map((r) => r.significant[0]! && r.significant[1]!);
  const scatter = {
    data: [
      {
        type: 'scattergl',
        mode: 'markers',
        name: 'features',
        x: shared.map((r) => r.log2_fc[0]),
        y: shared.map((r) => r.log2_fc[1]),
        text: shared.map((r) => r.feature_id),
        marker: { size: 6, color: bothHit.map((b) => (b ? '#c0392b' : '#9aa5b1')) },
        hovertemplate: '%{text}<br>x: %{x:.3g}<br>y: %{y:.3g}<extra></extra>',
      },
    ],
    layout: {
      xaxis: { title: { text: `log2 FC — ${labels[0]}` }, zeroline: true },
      yaxis: { title: { text: `log2 FC — ${labels[1]}` }, zeroline: true },
      showlegend: false,
      height: 480,
      annotations:
        leftOut || ambiguous
          ? [
              {
                text: `${inAll.length} accessions measured in every contrast; ${leftOut} missing somewhere and ${ambiguous} ambiguous left out`,
                xref: 'paper',
                yref: 'paper',
                x: 0,
                y: 1.08,
                showarrow: false,
                xanchor: 'left',
                font: { size: 11 },
              },
            ]
          : [],
    },
  };
  // UpSet-style: intersection sizes as bars over a dot matrix of memberships (Plotly only; no UpSet.js — AGPL).
  const n = labels.length;
  const upset = {
    data: [
      {
        type: 'bar',
        x: intersections.map((_, i) => i),
        y: intersections.map((s) => s.count),
        marker: { color: '#2471a3' },
        text: intersections.map((s) => String(s.count)),
        textposition: 'outside',
        xaxis: 'x',
        yaxis: 'y',
        hoverinfo: 'y',
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: intersections.flatMap((_, i) => labels.map(() => i)),
        y: intersections.flatMap(() => labels.map((_, j) => j)),
        marker: {
          size: 12,
          color: intersections.flatMap((s) => s.members.map((m) => (m ? '#24292f' : '#d0d7de'))),
        },
        xaxis: 'x',
        yaxis: 'y2',
        hoverinfo: 'skip',
      },
    ],
    layout: {
      grid: { rows: 2, columns: 1, roworder: 'top to bottom' },
      xaxis: { showticklabels: false, range: [-0.6, Math.max(intersections.length, 1) - 0.4] },
      yaxis: { title: { text: 'features' }, domain: [0.45, 1] },
      yaxis2: {
        domain: [0, 0.38],
        tickvals: labels.map((_, j) => j),
        ticktext: labels,
        range: [-0.6, n - 0.4],
        automargin: true,
      },
      showlegend: false,
      height: 300 + 30 * n,
    },
  };
  return {
    labels,
    measured_in_all: inAll.length,
    left_out: leftOut,
    ambiguous,
    total_overlap: overlap.length,
    overlap: overlap.slice(0, 2000),
    intersections,
    scatter,
    upset,
  };
}
