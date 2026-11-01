import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publishedDaRelease } from './testing-data.ts';
import { startTestApi, type TestApi } from './testing.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A saved chart (volcano) over one release, as the Explorer saves it. */
function chartView(release: string, name: string, visibility: 'private' | 'program', program?: string) {
  return {
    name,
    visibility,
    ...(program ? { program_id: program } : {}),
    query_spec: { source: { releaseIds: [release] } },
    chart_spec: {
      type: 'volcano',
      data: { source: { releaseIds: [release] } },
      encodings: { x: 'log2_fc', y: 'p_adj', label: 'feature_id' },
      options: {},
      layout: {
        palette: 'default',
        gridX: true,
        gridY: true,
        sharedX: false,
        sharedY: false,
        sharedLegend: true,
        subplotLegend: false,
      },
    },
  };
}

describe('lineage (SPEC M10)', () => {
  let t: TestApi;
  let P1: string;
  let contributor: string;
  let colleague: string;
  let outsider: string;
  let version: string;
  let release: string;
  let programChart: string;
  let privateChart: string;

  const lineage = (token: string, params: Record<string, string>) =>
    t.call(token, { method: 'GET', url: `/v1/lineage?${new URLSearchParams(params)}` });
  const keys = (graph: Json) => (graph.nodes as Json[]).map((n) => `${n.kind}:${n.id}`).sort();

  beforeAll(async () => {
    t = await startTestApi({ s3: true, query: true });
    P1 = await t.program('LIN');
    const P2 = await t.program('LIN2');
    contributor = (await t.user('lin-contributor', { [P1]: 'contributor' })).token;
    colleague = (await t.user('lin-colleague', { [P1]: 'contributor' })).token;
    outsider = (await t.user('lin-outsider', { [P2]: 'viewer' })).token;
    ({ version, release } = await publishedDaRelease(t, contributor, P1, 'Lineage source'));
    const save = async (token: string, body: Json) => {
      const res = await t.call(token, { method: 'POST', url: '/v1/views', payload: body });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as Json).id as string;
    };
    programChart = await save(contributor, chartView(release, 'Shared volcano', 'program', P1));
    privateChart = await save(colleague, chartView(release, 'Colleague private volcano', 'private'));
  });
  afterAll(async () => t?.close());

  it('LIN-01: a published release shows its file and experiment version upstream and saved charts downstream', async () => {
    const res = await lineage(contributor, { kind: 'dataset_release', id: release });
    expect(res.statusCode, res.body).toBe(200);
    const graph = res.json() as Json;
    expect(graph.root).toEqual({ kind: 'dataset_release', id: release });
    const byKind = Object.fromEntries((graph.nodes as Json[]).map((n) => [n.kind, n]));
    expect(byKind.file).toMatchObject({ label: 'toptable.tsv', depth: -1, program_code: 'LIN' });
    expect(byKind.experiment_version).toMatchObject({ label: 'Lineage source v1', depth: -1 });
    expect(byKind.dataset_release).toMatchObject({ depth: 0, status: 'published' });
    expect(byKind.chart).toMatchObject({ id: programChart, label: 'Shared volcano', depth: 1 });
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: `file:${byKind.file.id}`, to: `dataset_release:${release}`, relation: 'input_to' },
        { from: `experiment_version:${version}`, to: `dataset_release:${release}`, relation: 'describes' },
        { from: `dataset_release:${release}`, to: `chart:${programChart}`, relation: 'input_to' },
      ]),
    );
    expect(graph.truncated).toBe(false);
  });

  it('LIN-01: depth and direction limit the walk', async () => {
    const one = (await lineage(contributor, { kind: 'chart', id: programChart, depth: '1' })).json() as Json;
    expect(keys(one)).toEqual([`chart:${programChart}`, `dataset_release:${release}`].sort());
    const two = (await lineage(contributor, { kind: 'chart', id: programChart, depth: '2' })).json() as Json;
    expect((two.nodes as Json[]).map((n) => n.kind).sort()).toEqual(
      ['chart', 'dataset_release', 'experiment_version', 'file'].sort(),
    );
    const file = (two.nodes as Json[]).find((n) => n.kind === 'file')!.id as string;
    const down = (
      await lineage(contributor, { kind: 'file', id: file, direction: 'downstream', depth: '3' })
    ).json() as Json;
    expect((down.nodes as Json[]).map((n) => n.kind).sort()).toEqual(['chart', 'dataset_release', 'file']);
    expect((down.nodes as Json[]).every((n) => n.depth >= 0)).toBe(true);
  });

  it('LIN-01: nodes the caller may not read are left out; an unreadable root is 404', async () => {
    const graph = (await lineage(contributor, { kind: 'dataset_release', id: release })).json() as Json;
    expect(keys(graph)).not.toContain(`chart:${privateChart}`);
    const own = (await lineage(colleague, { kind: 'dataset_release', id: release })).json() as Json;
    expect(keys(own)).toContain(`chart:${privateChart}`);
    expect((await lineage(outsider, { kind: 'dataset_release', id: release })).statusCode).toBe(404);
    expect((await lineage(contributor, { kind: 'chart', id: privateChart })).statusCode).toBe(404);
  });

  it('LIN-01: the query is validated', async () => {
    expect(
      (await lineage(contributor, { kind: 'dataset_release', id: release, depth: '0' })).statusCode,
    ).toBe(400);
    expect(
      (await lineage(contributor, { kind: 'dataset_release', id: release, depth: '9' })).statusCode,
    ).toBe(400);
    expect((await lineage(contributor, { kind: 'sample', id: release })).statusCode).toBe(400);
  });
});
