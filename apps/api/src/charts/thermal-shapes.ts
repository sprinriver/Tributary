import type { ChartSpec, MeltingCurveOptions, ThermalShiftOptions } from '@tributary/contracts';
import { axisRefs, colourAt, enc, facets, one, toLabel, toNumber, type Row } from './common.ts';
import { dataError } from './errors.ts';
import type { Shaped } from './volcano.ts';

// Thermal proteome profiling charts (Phase 46). Display of stored values only: melting points, ΔTm and adjusted
// p-values are the source tool's (packages/importers/src/tpp_tr/SOURCE.md, Bioconductor TPP 3.40.2).
const CURVE_COLUMNS = ['temperatures_c', 'fc_treatment', 'fc_vehicle', 'melt_point_treatment', 'delta_tm'];
const ARMS = [
  { arm: 'vehicle', name: 'vehicle' },
  { arm: 'treatment', name: 'treatment' },
] as const;

const wrongKind = (chart: string) =>
  dataError(
    'wrong_kind',
    'data',
    `${chart} needs a thermal_shift dataset (melting points, ΔTm and fold changes by temperature).`,
  );
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
const numbers = (v: unknown) =>
  (Array.isArray(v) ? v : []).map((x) => (x === null || x === undefined ? null : Number(x)));

/**
 * TPP's melting curve (SOURCE.md; Savitski et al. 2014, doi:10.1126/science.1255784):
 * y(T) = (1 − Pl) / (1 + exp(−(a/T − b))) + Pl, T in °C as in the tool's config table.
 * Evaluating it with the stored a, b and plateau is display of the tool's fit, not a new fit.
 */
const fitted = (t: number, a: number, b: number, plateau: number) =>
  (1 - plateau) / (1 + Math.exp(-(a / t - b))) + plateau;

/** Melting curves: measured fold changes of vehicle and treatment by temperature, as small multiples. */
export function shapeMeltingCurve(rows: Row[], spec: ChartSpec, o: MeltingCurveOptions): Shaped {
  const e = enc(spec);
  const label = one(e, 'label')!;
  const panel = one(e, 'panel');
  if (rows.length && CURVE_COLUMNS.some((c) => !(c in rows[0]!))) throw wrongKind('The melting-curve chart');
  const p = (r: Row) => toNumber(r.adj_p_value);
  const byFilter = rows.filter((r) => !o.passed_filter_only || r.passed_filter === true);
  const noP = byFilter.filter((r) => p(r) === null).length;
  const matching = byFilter.filter(
    (r) => o.adj_p_max === undefined || (p(r) !== null && p(r)! <= o.adj_p_max),
  );
  // No ΔTm sorts last.
  const size = (r: Row) => {
    const d = toNumber(r.delta_tm);
    return d === null ? -1 : Math.abs(d);
  };
  const sorted = [...matching].sort((x, y) =>
    o.sort === 'abs_delta_tm_desc'
      ? size(y) - size(x)
      : (p(x) ?? Infinity) - (p(y) ?? Infinity) || size(y) - size(x),
  );
  const shown = sorted.slice(0, o.max_curves);
  const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(shown.length))));
  const data: Record<string, unknown>[] = [];
  const shapes: Record<string, unknown>[] = [];
  const annotations: Record<string, unknown>[] = [];
  const layout: Record<string, unknown> = {
    // ygap: room for the two-line panel titles above and the axis title below each row.
    grid: {
      rows: Math.max(1, Math.ceil(shown.length / columns)),
      columns,
      pattern: 'independent',
      ygap: 0.55,
    },
    showlegend: true,
    height: Math.max(360, 300 * Math.ceil(shown.length / columns)),
    margin: { t: 60 },
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  let unfitted = 0;
  shown.forEach((r, i) => {
    const refs = axisRefs(i);
    const temperatures = numbers(r.temperatures_c) as number[];
    ARMS.forEach(({ arm, name }, k) => {
      const colour = colourAt(spec, k);
      data.push({
        type: 'scatter',
        mode: 'markers',
        name,
        legendgroup: name,
        showlegend: i === 0,
        x: temperatures,
        y: numbers(r[`fc_${arm}`]),
        marker: { color: colour, size: 7 },
        ...refs,
      });
      const [a, b, plateau] = ['a', 'b', 'plateau'].map((c) => toNumber(r[`${c}_${arm}`]));
      const fit = a !== null && b !== null && plateau !== null && temperatures.length > 1;
      if (o.show_fit && !fit) unfitted += 1;
      if (o.show_fit && fit) {
        const [lo, hi] = [Math.min(...temperatures), Math.max(...temperatures)];
        const xs = Array.from({ length: 61 }, (_, n) => lo + ((hi - lo) * n) / 60);
        data.push({
          type: 'scatter',
          mode: 'lines',
          name: `${name} (fitted)`,
          legendgroup: name,
          showlegend: false,
          x: xs,
          y: xs.map((t) => fitted(t, a!, b!, plateau!)),
          line: { color: colour },
          hoverinfo: 'skip',
          ...refs,
        });
      }
      // The reported melting point (where the tool's fitted curve is 0.5).
      const tm = toNumber(r[`melt_point_${arm}`]);
      if (tm !== null)
        shapes.push({
          type: 'line',
          xref: refs.xaxis,
          yref: `${refs.yaxis} domain`,
          x0: tm,
          x1: tm,
          y0: 0,
          y1: 1,
          line: { color: colour, dash: 'dot', width: 1 },
        });
    });
    const delta = toNumber(r.delta_tm);
    annotations.push({
      // Two lines, so that long comparison names do not run into the next panel.
      text:
        `${toLabel(r[label])} · ${delta === null ? 'no ΔTm' : `ΔTm ${signed(delta)} °C`}` +
        (panel ? `<br>${toLabel(r[panel])}` : ''),
      showarrow: false,
      xref: `${refs.xaxis} domain`,
      yref: `${refs.yaxis} domain`,
      x: 0.5,
      y: 1.2,
      font: { size: 11 },
    });
    const s = i === 0 ? '' : String(i + 1);
    layout[`xaxis${s}`] = { title: { text: i === 0 ? 'temperature (°C)' : '' }, showgrid: spec.layout.gridX };
    layout[`yaxis${s}`] = {
      title: {
        text:
          i === 0
            ? `${r.fold_change_normalised === true ? 'normalised ' : ''}fold change vs lowest temperature`
            : '',
      },
      showgrid: spec.layout.gridY,
    };
  });
  if (!shown.length) {
    annotations.push({
      text: 'No curves match these filters (adjusted p, the tool’s filter).',
      showarrow: false,
      xref: 'paper',
      yref: 'paper',
      x: 0.5,
      y: 0.5,
      font: { size: 14 },
    });
    layout.xaxis = { visible: false };
    layout.yaxis = { visible: false };
  }
  layout.annotations = annotations;
  layout.shapes = shapes;
  const notes = [
    `${shown.length} of ${rows.length} protein × comparison rows shown (${o.passed_filter_only ? 'passed the tool’s filter; ' : ''}${o.adj_p_max !== undefined ? `adjusted p ≤ ${o.adj_p_max}; ` : ''}ordered by ${o.sort === 'adj_p_asc' ? 'adjusted p' : '|ΔTm|'})`,
    'points are the fold changes the tool reported; dotted lines are its melting points',
    ...(o.show_fit ? ['fitted curves drawn from the stored TPP parameters (a, b, plateau)'] : []),
    ...(o.show_fit && unfitted ? [`${unfitted} curve(s) without stored parameters are not drawn`] : []),
    ...(noP
      ? [
          `${noP} without an adjusted p-value${o.adj_p_max !== undefined ? ' are left out by the filter' : ' (not tested by the tool) come last'}`,
        ]
      : []),
  ];
  return { data, layout, rows: shown.length, dropped: 0, transformations: notes, compute: {} };
}

const CLASSES = [
  { key: 'stabilised', colour: '#d1242f' },
  { key: 'destabilised', colour: '#0969da' },
  { key: 'not significant', colour: '#8c959f' },
] as const;

/** ΔTm against −log10 adjusted p, one panel per comparison. −log10 is a display transform of the tool's p. */
export function shapeThermalShift(rows: Row[], spec: ChartSpec, o: ThermalShiftOptions): Shaped {
  const e = enc(spec);
  const label = one(e, 'label')!;
  const panel = one(e, 'panel');
  if (rows.length && !('delta_tm' in rows[0]! && 'adj_p_value' in rows[0]!))
    throw wrongKind('The thermal shift chart');
  const kept = rows.flatMap((r) => {
    const [x, p] = [toNumber(r.delta_tm), toNumber(r.adj_p_value)];
    return x === null || p === null || p <= 0 ? [] : [{ r, x, p, y: -Math.log10(p) }];
  });
  type Point = (typeof kept)[number];
  // null: the tool did not compute its replicate checks (not a 2 + 2 design, or a curve without a fit).
  const checks = (r: Row) =>
    r.fulfills_all_requirements === true
      ? 'yes'
      : r.fulfills_all_requirements === false
        ? 'no'
        : 'not computed by the tool';
  const noChecks = kept.length > 0 && kept.every((k) => checks(k.r) === 'not computed by the tool');
  const classOf = (k: Point) =>
    k.p > o.adj_p_max || Math.abs(k.x) < o.min_abs_delta_tm || k.x === 0
      ? 'not significant'
      : k.x > 0
        ? 'stabilised'
        : 'destabilised';
  const panels = facets(
    kept.map((k) => k.r),
    panel,
  ).map(([name]) => name);
  const many = panels.length > 1;
  const columns = Math.ceil(Math.sqrt(panels.length || 1));
  const data: Record<string, unknown>[] = [];
  const shapes: Record<string, unknown>[] = [];
  const annotations: Record<string, unknown>[] = [];
  const layout: Record<string, unknown> = {
    showlegend: true,
    legend: { title: { text: 'per comparison (one replicate pair)' } },
    ...(many ? { grid: { rows: Math.ceil(panels.length / columns), columns, pattern: 'independent' } } : {}),
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  const line = { color: '#57606a', dash: 'dash', width: 1 };
  (panels.length ? panels : ['']).forEach((name, i) => {
    const refs = axisRefs(i);
    const points = kept.filter((k) => !panel || toLabel(k.r[panel]) === name);
    for (const { key, colour } of CLASSES) {
      const of = points.filter((k) => classOf(k) === key);
      data.push({
        type: 'scatter',
        mode: 'markers',
        name: key,
        legendgroup: key,
        showlegend: i === 0,
        x: of.map((k) => k.x),
        y: of.map((k) => k.y),
        text: of.map((k) => toLabel(k.r[label])),
        customdata: of.map((k) => [k.p, checks(k.r)]),
        hovertemplate:
          '%{text}<br>ΔTm %{x:.2f} °C<br>adjusted p %{customdata[0]:.3g}' +
          '<br>all of the tool’s replicate checks: %{customdata[1]}<extra></extra>',
        marker: {
          color: colour,
          size: 7,
          // Diamonds: proteins that met all of the tool's replicate checks (its own hit call).
          symbol: of.map((k) => (k.r.fulfills_all_requirements === true ? 'diamond' : 'circle')),
        },
        ...refs,
      });
    }
    const y = -Math.log10(o.adj_p_max);
    shapes.push({
      type: 'line',
      xref: `${refs.xaxis} domain`,
      yref: refs.yaxis,
      x0: 0,
      x1: 1,
      y0: y,
      y1: y,
      line,
    });
    if (o.min_abs_delta_tm > 0)
      for (const s of [-1, 1])
        shapes.push({
          type: 'line',
          xref: refs.xaxis,
          yref: `${refs.yaxis} domain`,
          x0: s * o.min_abs_delta_tm,
          x1: s * o.min_abs_delta_tm,
          y0: 0,
          y1: 1,
          line,
        });
    if (many)
      annotations.push({
        text: name,
        showarrow: false,
        xref: `${refs.xaxis} domain`,
        yref: `${refs.yaxis} domain`,
        x: 0.5,
        y: 1.08,
        font: { size: 12 },
      });
    points
      .filter((k) => classOf(k) !== 'not significant')
      .sort((a, b) => a.p - b.p || Math.abs(b.x) - Math.abs(a.x))
      .slice(0, o.label_top)
      .forEach((k) =>
        annotations.push({
          x: k.x,
          y: k.y,
          xref: refs.xaxis,
          yref: refs.yaxis,
          text: toLabel(k.r[label]),
          showarrow: true,
          arrowhead: 0,
          ax: 0,
          ay: -18,
          font: { size: 11 },
        }),
      );
    const s = i === 0 ? '' : String(i + 1);
    layout[`xaxis${s}`] = {
      title: { text: spec.axes?.x?.title ?? 'ΔTm (°C), treatment − vehicle' },
      showgrid: spec.layout.gridX,
    };
    layout[`yaxis${s}`] = {
      title: { text: i === 0 ? (spec.axes?.y?.title ?? '−log10 adjusted p') : '' },
      showgrid: spec.layout.gridY,
    };
  });
  layout.shapes = shapes;
  layout.annotations = annotations;
  const dropped = rows.length - kept.length;
  const notes = [
    'ΔTm = melting point of the treatment − vehicle, as the tool reported it; positive: stabilised',
    `y = −log10 of the tool’s adjusted p; classed at adjusted p ≤ ${o.adj_p_max}${o.min_abs_delta_tm > 0 ? ` and |ΔTm| ≥ ${o.min_abs_delta_tm} °C` : ''}, per comparison`,
    'only proteins that passed the tool’s filter were tested, so the adjustment covers those proteins only',
    noChecks
      ? 'the tool’s replicate checks were not computed for this table (they need two treatment and two vehicle experiments)'
      : 'diamonds: proteins that met all of the tool’s replicate checks',
    ...(dropped
      ? [
          `${dropped} row(s) without an adjusted p-value or ΔTm are not plotted (failed the tool’s curve filter, or no fit)`,
        ]
      : []),
  ];
  return { data, layout, rows: kept.length, dropped, transformations: notes, compute: {} };
}
