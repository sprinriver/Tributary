// Shared fixtures of the chart shaping tests (split from shape-more.test.ts to keep files under 400 lines).
import { chartDefaults, type ChartSpec, type ChartType } from '@tributary/contracts';
import type { Compute } from './compute.ts';
import { shapeChart } from './dispatch.ts';

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const layout = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};
export const spec = (
  type: ChartType,
  encodings: ChartSpec['encodings'],
  extra: Partial<ChartSpec> = {},
): ChartSpec =>
  ({
    type,
    data: { savedViewId: '019a2b3c-4d5e-7f00-8a00-000000000003' },
    encodings,
    options: {},
    layout,
    ...extra,
  }) as ChartSpec;

export const rows = [
  { id: 'P1', g: 'DMSO', h: 'A', run: 'r1', a: 1, b: 10, c: 2, d: 0.01, cond: 'DMSO' },
  { id: 'P2', g: 'DMSO', h: 'B', run: 'r2', a: 2, b: 20, c: 3, d: 0.2, cond: 'DMSO' },
  { id: 'P3', g: 'CPD', h: 'A', run: 'r1', a: 3, b: 35, c: 5, d: 0.001, cond: 'CPD' },
  { id: 'P4', g: 'CPD', h: 'B', run: 'r2', a: 4, b: 38, c: 7, d: 0.5, cond: 'CPD' },
  { id: 'P5', g: 'CPD', h: 'A', run: 'r3', a: 5, b: 50, c: 11, d: 0.03, cond: 'CPD' },
  { id: 'P6', g: 'DMSO', h: 'B', run: 'r3', a: 6, b: 59, c: 13, d: 0.9, cond: 'DMSO' },
];

/** Deterministic stand-in for apps/compute (its statistics are tested in pytest). */
export const calls: { path: string; body: Json }[] = [];
export const compute: Compute = {
  cluster: async () => {
    throw new Error('not used');
  },
  kde: async (body) => {
    calls.push({ path: 'kde', body });
    const v = body.values as number[];
    return {
      x: [Math.min(...v), Math.max(...v)],
      density: [0.5, 0.5],
      bandwidth: 1,
      compute_version: 'test',
    };
  },
  groupTest: async (body) => {
    calls.push({ path: 'group-test', body });
    const groups = body.groups as { name: string }[];
    const pairwise = ['welch_t', 'mann_whitney', 'ks'].includes(body.method as string);
    return {
      method: body.method as string,
      overall_p: pairwise ? null : 0.004,
      comparisons: pairwise
        ? groups.slice(1).map((g) => ({ group: g.name, reference: groups[0]!.name, p: 0.02, p_adj: 0.04 }))
        : [],
      adj_method: 'BH',
      compute_version: 'test',
    };
  },
  groupSummary: async (body) => {
    calls.push({ path: 'group-summary', body });
    return {
      groups: (body.groups as { name: string; values: number[] }[]).map((g) => {
        const n = g.values.length;
        const mean = g.values.reduce((s, v) => s + v, 0) / n;
        const sd = n > 1 ? Math.sqrt(g.values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
        return {
          name: g.name,
          n,
          mean,
          sd,
          sem: sd === null ? null : sd / Math.sqrt(n),
          ci95: sd === null ? null : 2 * sd,
          median: mean,
          cv: sd === null || mean === 0 ? null : sd / mean,
        };
      }),
      compute_version: 'test',
    };
  },
  pca: async (body) => {
    calls.push({ path: 'pca', body });
    const n = (body.values as number[][]).length;
    const k = body.components as number;
    return {
      scores: [...Array(n).keys()].map((i) => [...Array(k).keys()].map((j) => i * (j + 1))),
      loadings: [],
      explained_variance_ratio: [...Array(k).keys()].map((j) => 0.5 / (j + 1)),
      compute_version: 'test',
    };
  },
};

export const shape = (
  type: ChartType,
  encodings: ChartSpec['encodings'],
  options: Record<string, unknown> = {},
  data: Record<string, unknown>[] = rows,
) =>
  shapeChart(
    type,
    data,
    spec(type, encodings),
    { ...chartDefaults(type), ...options },
    compute,
  ) as Promise<Json>;
export const ys = (s: Json) => s.data.flatMap((t: Json) => t.y ?? []);
export const xs = (s: Json) => s.data.flatMap((t: Json) => t.x ?? []);
