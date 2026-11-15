import { chartDefaults, type ChartSpec, type ChartType } from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import type { Compute } from './compute.ts';
import { shapeChart } from './dispatch.ts';

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
const temperatures = [37, 41, 44, 47, 50, 53, 56, 59, 63, 67];
const vehicle = [1, 0.98, 0.95, 0.85, 0.6, 0.35, 0.15, 0.08, 0.04, 0.02];
const treated = [1, 0.99, 0.97, 0.93, 0.85, 0.7, 0.45, 0.25, 0.1, 0.05];
// TPP's model (SOURCE.md): y(T) = (1 − Pl) / (1 + exp(−(a/T − b))) + Pl; with Pl = 0 the curve is 0.5 at T = a/b.
const shift = (feature: string, deltaTm: number | null, adjP: number | null, more: Json = {}) => ({
  feature_id: feature,
  comparison: 'CPD5_1 vs Vehicle_1',
  treatment_experiment: 'CPD5_1',
  vehicle_experiment: 'Vehicle_1',
  temperatures_c: temperatures,
  fc_treatment: treated,
  fc_vehicle: vehicle,
  melt_point_treatment: deltaTm === null ? null : 50 + deltaTm,
  melt_point_vehicle: 50,
  delta_tm: deltaTm,
  adj_p_value: adjP,
  a_treatment: 550,
  b_treatment: 10,
  plateau_treatment: 0,
  a_vehicle: 500,
  b_vehicle: 10,
  plateau_vehicle: 0,
  passed_filter: true,
  fulfills_all_requirements: false,
  ...more,
});
const rows = [
  shift('TP53', 5, 0.001, { fulfills_all_requirements: true }),
  shift('EGFR', -3, 0.01),
  shift('AKT1', 0.4, 0.6),
  shift('PTEN', 8, null, { passed_filter: false }),
  shift('CDK2', null, null, {
    passed_filter: null,
    fc_treatment: temperatures.map(() => null),
    a_treatment: null,
    b_treatment: null,
    plateau_treatment: null,
  }),
];
const spec = (type: ChartType, encodings: Json = { label: 'feature_id' }) =>
  ({
    type,
    data: { savedViewId: '019a2b3c-4d5e-7f00-8a00-000000000003' },
    encodings,
    options: {},
    layout,
  }) as ChartSpec;
const compute = {} as Compute;
const shape = (type: ChartType, options: Json = {}, data: Json[] = rows, encodings?: Json) =>
  shapeChart(
    type,
    data,
    spec(type, encodings),
    { ...chartDefaults(type), ...options },
    compute,
  ) as Promise<Json>;
const titles = (s: Json) => (s.layout.annotations as Json[]).map((a) => String(a.text).split(' · ')[0]);

describe('melting curves', () => {
  it('TPP-03: melting_curve draws the measured fold changes of vehicle and treatment by temperature, most significant first', async () => {
    const s = await shape('melting_curve');
    expect(titles(s)).toEqual(['TP53', 'EGFR', 'AKT1', 'PTEN', 'CDK2']); // no adjusted p: last, still shown
    const points = s.data.filter((t: Json) => t.mode === 'markers');
    expect(points[0]).toMatchObject({ name: 'vehicle', x: temperatures, y: vehicle, xaxis: 'x', yaxis: 'y' });
    expect(points[1]).toMatchObject({
      name: 'treatment',
      x: temperatures,
      y: treated,
      xaxis: 'x',
      yaxis: 'y',
    });
    expect(points[2]).toMatchObject({ xaxis: 'x2', yaxis: 'y2' });
    expect(s.layout.xaxis.title.text).toBe('temperature (°C)');
    expect((s.layout.annotations as Json[])[0].text).toContain('ΔTm +5.00 °C');
    expect(s.rows).toBe(5);
  });

  it('TPP-03: melting_curve marks the reported melting points and draws the fitted curve only from stored parameters', async () => {
    const s = await shape('melting_curve');
    const lines = s.data.filter((t: Json) => t.mode === 'lines');
    expect(lines).toHaveLength(9); // CDK2's treatment has no stored parameters: no curve is made up
    const first = lines[0] as { x: number[]; y: number[] };
    const at = first.x.findIndex((x) => Math.abs(x - 50) < 1e-9);
    expect(first.y[at]).toBeCloseTo(0.5, 9); // vehicle: a/b = 50 °C
    expect(first.y[0]).toBeGreaterThan(0.9);
    const marks = (s.layout.shapes as Json[]).filter((m) => m.xref === 'x');
    expect(marks.map((m) => m.x0)).toEqual([50, 55]);
    expect(s.transformations.join(' ')).toMatch(/fitted curves drawn from the stored TPP parameters/);
    expect(s.transformations.join(' ')).toMatch(/1 curve\(s\) without stored parameters/);
    const off = await shape('melting_curve', { show_fit: false });
    expect(off.data.filter((t: Json) => t.mode === 'lines')).toHaveLength(0);
    expect(off.layout.shapes).toHaveLength(9); // melting points stay: they are reported values
  });

  it('TPP-03: melting_curve filters by adjusted p and the tool’s filter, orders by |ΔTm| and caps the panels', async () => {
    const strict = await shape('melting_curve', { adj_p_max: 0.05 });
    expect(titles(strict)).toEqual(['TP53', 'EGFR']);
    expect(strict.transformations.join(' ')).toMatch(/2 without an adjusted p-value are left out/);
    expect(titles(await shape('melting_curve', { passed_filter_only: true }))).toEqual([
      'TP53',
      'EGFR',
      'AKT1',
    ]);
    expect(titles(await shape('melting_curve', { sort: 'abs_delta_tm_desc' }))).toEqual([
      'PTEN',
      'TP53',
      'EGFR',
      'AKT1',
      'CDK2',
    ]);
    expect(titles(await shape('melting_curve', { max_curves: 2 }))).toEqual(['TP53', 'EGFR']);
    const none = await shape('melting_curve', { adj_p_max: 0.0001 });
    expect(none.data).toEqual([]);
    expect(none.layout.annotations[0].text).toMatch(/No curves match/);
  });

  it('TPP-03: melting_curve refuses a dataset that is not a thermal_shift', async () => {
    await expect(shape('melting_curve', {}, [{ feature_id: 'P1', log2_fc: 1 }])).rejects.toMatchObject({
      body: { code: 'wrong_kind', field: 'data' },
    });
  });
});

describe('thermal shift plot', () => {
  it('TPP-04: thermal_shift plots ΔTm against −log10 adjusted p and names what is not plotted', async () => {
    const s = await shape('thermal_shift');
    const by = Object.fromEntries(s.data.map((t: Json) => [t.name, t]));
    expect(by.stabilised).toMatchObject({ x: [5], text: ['TP53'] });
    expect(by.stabilised.y[0]).toBeCloseTo(3, 9);
    expect(by.destabilised).toMatchObject({ x: [-3], text: ['EGFR'] });
    expect(by['not significant']).toMatchObject({ x: [0.4], text: ['AKT1'] });
    expect(by.stabilised.marker.symbol).toEqual(['diamond']); // the tool’s replicate-level call
    expect(by.destabilised.marker.symbol).toEqual(['circle']);
    expect(s.rows).toBe(3);
    expect(s.dropped).toBe(2);
    expect(s.transformations.join(' ')).toMatch(
      /2 row\(s\) without an adjusted p-value or ΔTm are not plotted/,
    );
    expect(s.transformations.join(' ')).toMatch(/treatment − vehicle/);
    expect(s.layout.xaxis.title.text).toBe('ΔTm (°C), treatment − vehicle');
    expect(s.layout.yaxis.title.text).toBe('−log10 adjusted p');
  });

  it('TPP-04: thermal_shift thresholds and labels change the classes and the annotations', async () => {
    const names = (s: Json, name: string) => s.data.find((t: Json) => t.name === name)?.text ?? [];
    const strict = await shape('thermal_shift', { adj_p_max: 0.005 });
    expect(names(strict, 'destabilised')).toEqual([]);
    expect(names(strict, 'not significant').sort()).toEqual(['AKT1', 'EGFR']);
    const wide = await shape('thermal_shift', { min_abs_delta_tm: 4 });
    expect(names(wide, 'stabilised')).toEqual(['TP53']);
    expect(names(wide, 'not significant').sort()).toEqual(['AKT1', 'EGFR']);
    const labels = (s: Json) =>
      (s.layout.annotations as Json[]).filter((a) => a.showarrow).map((a) => a.text);
    expect(labels(await shape('thermal_shift'))).toEqual(['TP53', 'EGFR']); // only classed points are labelled
    expect(labels(await shape('thermal_shift', { label_top: 1 }))).toEqual(['TP53']);
    expect(labels(await shape('thermal_shift', { label_top: 0 }))).toEqual([]);
  });

  it('TPP-04: thermal_shift draws one panel per comparison', async () => {
    const two = [...rows, shift('TP53', 4, 0.002, { comparison: 'CPD5_2 vs Vehicle_2' })];
    const s = await shape('thermal_shift', {}, two, { label: 'feature_id', panel: 'comparison' });
    expect(s.layout.grid).toMatchObject({ columns: 2 });
    expect(s.data.some((t: Json) => t.xaxis === 'x2')).toBe(true);
    expect((s.layout.annotations as Json[]).filter((a) => !a.showarrow).map((a) => a.text)).toEqual([
      'CPD5_1 vs Vehicle_1',
      'CPD5_2 vs Vehicle_2',
    ]);
  });
});
