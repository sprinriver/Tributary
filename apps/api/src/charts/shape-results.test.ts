import { chartDefaults, type ChartSpec, type VolcanoOptions } from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import type { Compute } from './compute.ts';
import { shapeChart } from './dispatch.ts';
import { shapeVolcano } from './volcano.ts';

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
const doses = [1e-9, 1e-8, 1e-7, 1e-6];
const curve = (feature: string, regulation: string, fdr: number, pec50: number) => ({
  feature_id: feature,
  compound_id: 'CPD-000001',
  doses_molar: doses,
  responses: [1, 0.9, 0.5, 0.2],
  pec50,
  hill_slope: 1,
  top: 1,
  bottom: 0.2,
  regulation,
  fdr,
});
const rows = [
  curve('P1', 'down', 0.001, 7.2),
  curve('P2', 'up', 0.02, 6.1),
  curve('P3', 'not', 0.5, 5.0),
  curve('P4', 'down', 0.04, 8.0),
];
const spec = {
  type: 'dose_response',
  data: { savedViewId: '019a2b3c-4d5e-7f00-8a00-000000000003' },
  encodings: { label: 'feature_id' },
  options: {},
  layout,
} as ChartSpec;
const compute = {} as Compute;
const shape = (options: Record<string, unknown> = {}) =>
  shapeChart(
    'dose_response',
    rows,
    spec,
    { ...chartDefaults('dose_response'), ...options },
    compute,
  ) as Promise<Json>;
const titles = (s: Json) => (s.layout.annotations as Json[]).map((a) => a.text);

describe('dose-response viewer', () => {
  it('RES-02: small multiples of measured responses with the fitted curve, filtered by regulation and FDR', async () => {
    const base = await shape();
    expect(titles(base)).toEqual(['P1', 'P2', 'P4']);
    const points = base.data.filter((t: Json) => t.mode === 'markers');
    expect(points[0]).toMatchObject({ x: doses, y: [1, 0.9, 0.5, 0.2], xaxis: 'x', yaxis: 'y' });
    const fit = base.data.find((t: Json) => t.mode === 'lines');
    // CurveCurator log-logistic: bottom + (top − bottom) / (1 + 10^(slope·(log10 d − log10 EC50))), EC50 = 10^−pEC50.
    const ec50 = 10 ** -7.2;
    const i = (fit.x as number[]).findIndex((d) => Math.abs(Math.log10(d) - Math.log10(ec50)) < 0.05);
    expect(fit.y[i]).toBeCloseTo(0.6, 1);
    expect(base.layout.xaxis.type).toBe('log');
    expect(base.transformations.join(' ')).toMatch(/3 of 4 curves/);
  });

  it('RES-02: every option changes the output', async () => {
    expect(titles(await shape({ regulation: ['up'] }))).toEqual(['P2']);
    expect(titles(await shape({ regulation: ['up', 'down', 'not'] }))).toHaveLength(4);
    expect(titles(await shape({ fdr_max: 0.01 }))).toEqual(['P1']);
    expect(titles(await shape({ max_curves: 1 }))).toEqual(['P1']);
    expect(titles(await shape({ sort: 'pec50_desc' }))).toEqual(['P4', 'P1', 'P2']);
    expect((await shape({ show_fit: false })).data.some((t: Json) => t.mode === 'lines')).toBe(false);
    expect((await shape({ log_dose: false })).layout.xaxis.type).toBe('linear');
  });

  it('RES-02: rows of another kind are a field error, not a broken chart', async () => {
    await expect(
      shapeChart(
        'dose_response',
        [{ feature_id: 'P1', x: 1 }],
        spec,
        chartDefaults('dose_response'),
        compute,
      ),
    ).rejects.toMatchObject({ body: { code: 'wrong_kind', field: 'data' } });
  });
});

describe('volcano known-target overlay', () => {
  it('RES-04: highlighted ids (any accession of a protein group) get their own labelled trace', () => {
    const da = [
      { id: 'P1;P9', fc: 2, p: 0.001 },
      { id: 'P2', fc: -2, p: 0.002 },
      { id: 'P3', fc: 0.1, p: 0.5 },
    ];
    const vSpec = { ...spec, type: 'volcano', encodings: { x: 'fc', y: 'p', label: 'id' } } as ChartSpec;
    const o = chartDefaults('volcano') as VolcanoOptions;
    const plain = shapeVolcano(da, vSpec, o) as Json;
    expect(plain.data).toHaveLength(3);
    const overlay = shapeVolcano(da, vSpec, {
      ...o,
      highlight: ['P9', 'P3'],
      highlight_label: 'CPD-1 targets',
    }) as Json;
    const known = overlay.data.find((t: Json) => String(t.name).startsWith('CPD-1 targets'));
    expect(known.name).toBe('CPD-1 targets (2)');
    expect(known.customdata.map((c: Json) => c[0])).toEqual(['P1;P9', 'P3']);
    expect(overlay.transformations.join(' ')).toMatch(/2 of 2 highlighted ids found/);
  });
});
