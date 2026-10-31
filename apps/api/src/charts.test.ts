import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApi, type TestApi } from './testing.ts';
import { publishedDaRelease, topTable } from './testing-data.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const layout = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};

/** Records apps/compute calls and answers clustering with reversed leaf orders (correctness is tested in pytest). */
function computeStub() {
  const calls: { path: string; body: Json }[] = [];
  const tree = (n: number, support: boolean) => ({
    order: [...Array(n).keys()].reverse(),
    linkage: [...Array(n - 1).keys()].map((k) => [k === 0 ? 0 : n + k - 1, k + 1, k + 1, k + 2]),
    support: support ? [...Array(n - 1).keys()].map(() => 0.5) : null,
  });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = JSON.parse(String(init?.body ?? '{}')) as Json;
    calls.push({ path: url.pathname, body });
    if (url.pathname === '/stats/cluster') {
      const rows = body.values.length as number;
      const cols = body.values[0].length as number;
      return Response.json({
        rows: body.axis === 'columns' ? null : tree(rows, body.bootstrap_n > 0),
        columns: body.axis === 'rows' ? null : tree(cols, body.bootstrap_n > 0),
        seed: body.seed,
        method: body.method,
        metric: body.metric,
        compute_version: 'tributary-compute 0.0.0; scipy 1.18.0',
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('chart rendering (/v1/charts/render)', () => {
  let t: TestApi;
  let token: string;
  let release: string;
  const stub = computeStub();

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true, fetch: stub.fetchImpl });
    const program = await t.program('CHT');
    token = (await t.user('chart-user', { [program]: 'contributor' })).token;
    ({ release } = await publishedDaRelease(t, token, program, 'Charts DA'));
  }, 300_000);
  afterAll(() => t.close());

  const render = (spec: Json) =>
    t.call(token, { method: 'POST', url: '/v1/charts/render', payload: { spec } });
  const da = (extra: Json = {}) => ({ source: { releaseIds: [release] }, ...extra });

  it('VIZ-02: volcano — −log10 p, threshold classes, threshold lines, labelled top hits, WebGL, provenance', async () => {
    const res = await render({
      type: 'volcano',
      data: da(),
      encodings: { x: 'log2_fc', y: 'adj_p_value', label: 'feature_id' },
      options: { fc_threshold: 1, p_threshold: 0.05, label_top: 5 },
      axes: { x: { title: 'log2 fold change (CPD-000005@1 µM vs DMSO)' } },
      layout,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Json;
    const rows = topTable();
    const up = rows.filter((r) => r.logFC >= 1 && r.adjP <= 0.05);
    const down = rows.filter((r) => r.logFC <= -1 && r.adjP <= 0.05);
    const traces = Object.fromEntries((body.figure.data as Json[]).map((tr) => [tr.name, tr]));
    expect(traces[`Up (${up.length})`].x).toHaveLength(up.length);
    expect(traces[`Down (${down.length})`].x).toHaveLength(down.length);
    expect(Object.values(traces).every((tr) => tr.type === 'scattergl')).toBe(true);
    const all = (body.figure.data as Json[]).flatMap((tr) => tr.customdata.map((c: Json) => c[0]));
    expect(all.sort()).toEqual(rows.map((r) => r.id).sort());
    const first = up[0] ?? down[0]!;
    const trace = up.includes(first) ? traces[`Up (${up.length})`] : traces[`Down (${down.length})`];
    const i = trace.customdata.findIndex((c: Json) => c[0] === first.id);
    expect(trace.y[i]).toBeCloseTo(-Math.log10(first.adjP), 9);
    expect(body.figure.layout.shapes).toHaveLength(3);
    expect(body.figure.layout.annotations).toHaveLength(5);
    expect(body.figure.layout.xaxis.title.text).toBe('log2 fold change (CPD-000005@1 µM vs DMSO)');
    expect(body.figure.layout.yaxis.title.text).toBe('−log10(adj_p_value)');
    expect(body.provenance).toMatchObject({
      release_ids: [release],
      sql_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      rows: rows.length,
      dropped_rows: 0,
      chart_spec: { type: 'volcano' },
    });
  });

  it('VIZ-01: an invalid spec is rejected with field-level errors before any data is read', async () => {
    const res = await render({
      type: 'volcano',
      data: da(),
      encodings: { x: 'feature_id' },
      options: { label_top: 10 },
      layout,
    });
    expect(res.statusCode).toBe(400);
    const fields = ((res.json() as Json).errors as Json[]).map((e) => `${e.field}:${e.code}`);
    expect(fields).toEqual(
      expect.arrayContaining([
        'encodings.y:required',
        'encodings.x:wrong_type',
        'options.label_top:requires',
      ]),
    );
  });

  it('VIZ-02: −log10 of values that are not p-values is a field error on y', async () => {
    const res = await render({
      type: 'volcano',
      data: da(),
      encodings: { x: 'log2_fc', y: 'log2_fc' },
      options: {},
      layout,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'p_out_of_range', field: 'encodings.y' });
  });

  it('VIZ-03: heatmap — every clustering combination renders; leaf orders reorder the matrix', async () => {
    const base = {
      type: 'heatmap',
      data: da({
        where: { combinator: 'and', rules: [{ field: 'adj_p_value', operator: '<', value: 0.2 }] },
        orderBy: [{ column: 'feature_id', dir: 'asc' }],
      }),
      encodings: { values: ['log2_fc', 't_stat', 'avg_log2_abundance'], rowLabel: 'feature_id' },
      layout,
    };
    const ids = topTable()
      .filter((r) => r.adjP < 0.2)
      .map((r) => r.id)
      .sort();
    for (const [rows, cols, axis] of [
      [false, false, null],
      [true, false, 'rows'],
      [false, true, 'columns'],
      [true, true, 'both'],
    ] as const) {
      stub.calls.length = 0;
      const res = await render({
        ...base,
        options: { cluster_rows: rows, cluster_columns: cols, dendrograms: rows || cols },
      });
      expect(res.statusCode, `${rows}/${cols}: ${res.body}`).toBe(200);
      const heat = ((res.json() as Json).figure.data as Json[]).find((tr) => tr.type === 'heatmap')!;
      expect(heat.y).toEqual(rows ? [...ids].reverse() : ids);
      expect(heat.x).toEqual(
        cols ? ['avg_log2_abundance', 't_stat', 'log2_fc'] : ['log2_fc', 't_stat', 'avg_log2_abundance'],
      );
      expect(stub.calls.map((c) => c.body.axis)).toEqual(axis ? [axis] : []);
      if (rows || cols)
        expect(((res.json() as Json).figure.data as Json[]).some((tr) => tr.type === 'scatter')).toBe(true);
    }
  });

  it('VIZ-03: dendrogram — bootstrap N and seed reach compute; support and compute version are in provenance', async () => {
    stub.calls.length = 0;
    const res = await render({
      type: 'dendrogram',
      data: da({
        where: { combinator: 'and', rules: [{ field: 'adj_p_value', operator: '<', value: 0.2 }] },
      }),
      encodings: { values: ['log2_fc', 't_stat', 'avg_log2_abundance'], rowLabel: 'feature_id' },
      options: { bootstrap_n: 25, seed: 7, method: 'complete', metric: 'correlation' },
      layout,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(stub.calls[0]!.body).toMatchObject({
      bootstrap_n: 25,
      seed: 7,
      method: 'complete',
      metric: 'correlation',
      axis: 'rows',
    });
    const body = res.json() as Json;
    expect(body.figure.layout.annotations.length).toBeGreaterThan(0);
    expect(body.provenance.compute).toMatchObject({
      cluster: 'tributary-compute 0.0.0; scipy 1.18.0',
      seed: 7,
    });
  });

  it('VIZ-01: clustering drops rows with missing values and reports how many (null policy)', async () => {
    const res = await render({
      type: 'heatmap',
      data: da(),
      encodings: { values: ['log2_fc', 'se'], rowLabel: 'feature_id' },
      options: { cluster_rows: true },
      layout,
    });
    // limma topTables carry no standard error (the importer leaves `se` null): no complete row is left to cluster.
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'too_few_rows', field: 'encodings.values' });
  });
});
