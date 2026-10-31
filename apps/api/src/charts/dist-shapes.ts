import type { ChartSpec } from '@tributary/contracts';
import type { Compute } from './compute.ts';
import {
  axisRefs,
  axisValues,
  baseLayout,
  colourAt,
  complete,
  enc,
  facets,
  groupBy,
  legend,
  num,
  one,
  toLabel,
  toNumber,
  type Row,
} from './common.ts';
import { dataError } from './errors.ts';
import { pseudolog } from './transforms.ts';
import type { Shaped } from './volcano.ts';
import { pValueNotes } from './xy-shapes.ts';

type O = Record<string, unknown>;

export async function shapeBox(rows: Row[], spec: ChartSpec, o: O, compute: Compute): Promise<Shaped> {
  const e = enc(spec);
  const [x, y] = [one(e, 'x')!, one(e, 'y')!];
  const { kept, dropped } = complete(rows, [y], [x]);
  const panels = facets(kept, one(e, 'panel'));
  const h = o.orientation === 'h';
  const data = panels.flatMap(([panel, pr], pi) =>
    groupBy(pr, one(e, 'color')).map(([group, gr], gi) => {
      const cats = gr.map((r) => toLabel(r[x]));
      const vals = gr.map((r) => num(r, y));
      const violin = o.kind !== 'box';
      return {
        type: violin ? 'violin' : 'box',
        orientation: o.orientation,
        [h ? 'y' : 'x']: cats,
        [h ? 'x' : 'y']: vals,
        ...(violin
          ? {
              points: o.points === 'none' ? false : o.points,
              box: { visible: o.kind === 'both' },
              meanline: { visible: true },
            }
          : { boxpoints: o.points === 'none' ? false : o.points }),
        marker: { color: colourAt(spec, gi) },
        ...legend(spec, group || y, pi, panel),
        ...axisRefs(pi),
      };
    }),
  );
  const layout = baseLayout(spec, panels.length > 1 ? panels.map(([p]) => p) : [], {
    x: h ? y : x,
    y: h ? x : y,
  });
  layout[o.kind === 'box' ? 'boxmode' : 'violinmode'] = 'group';
  let info: Record<string, string> = {};
  if (o.p_values !== 'none') {
    const p = await pValueNotes(
      groupBy(kept, x).map(([c, cr]) => [c, cr.map((r) => num(r, y))]),
      o.p_values as string,
      compute,
    );
    layout.annotations = [...((layout.annotations as unknown[]) ?? []), ...p.annotations];
    info = p.compute;
  }
  return { data, layout, rows: kept.length, dropped, transformations: [], compute: info };
}

export async function shapeHistogram(rows: Row[], spec: ChartSpec, o: O, compute: Compute): Promise<Shaped> {
  const e = enc(spec);
  const x = one(e, 'x')!;
  const { kept, dropped } = complete(rows, [x]);
  const notes: string[] = [];
  const xs = axisValues(
    kept.map((r) => num(r, x)),
    { log: o.pseudolog_x === true, base: o.pseudolog_base as number | undefined },
    x,
    notes,
  );
  const value = new Map(kept.map((r, i) => [r, xs[i]!]));
  const panels = facets(kept, one(e, 'panel'));
  const info: Record<string, string> = {};
  const data: Record<string, unknown>[] = [];
  const shapes: Record<string, unknown>[] = [];
  for (const [pi, [panel, pr]] of panels.entries()) {
    for (const [gi, [group, gr]] of groupBy(pr, one(e, 'color')).entries()) {
      const v = gr.map((r) => value.get(r)!);
      const name = group || x;
      if (o.kind !== 'kde')
        data.push({
          type: 'histogram',
          x: v,
          ...(o.bins ? { nbinsx: o.bins } : {}),
          ...(o.kind === 'both' ? { histnorm: 'probability density' } : {}),
          opacity: 0.6,
          marker: { color: colourAt(spec, gi) },
          ...legend(spec, name, pi, panel),
          ...axisRefs(pi),
        });
      if (o.kind !== 'histogram') {
        // v1 failed with "dataset should have multiple elements": say which group and why instead.
        if (new Set(v).size < 2)
          throw dataError(
            'too_few_values',
            'encodings.x',
            `"${name}" has fewer than 2 distinct values after filtering; a density needs at least 2.`,
          );
        const k = await compute.kde({ values: v, points: 256, bandwidth: 'scott' });
        info.kde = `${k.compute_version}; Scott bandwidth`;
        data.push({
          type: 'scatter',
          mode: 'lines',
          x: k.x,
          y: k.density,
          line: { color: colourAt(spec, gi), width: 2 },
          ...legend(spec, `${name} density`, pi, panel),
          ...axisRefs(pi),
        });
      }
      if (o.stats) {
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const sorted = [...v].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
        const { xaxis, yaxis } = axisRefs(pi);
        for (const [at, dash] of [
          [mean, 'solid'],
          [median, 'dot'],
        ] as const)
          shapes.push({
            type: 'line',
            xref: xaxis,
            yref: `${yaxis} domain`,
            x0: at,
            x1: at,
            y0: 0,
            y1: 1,
            line: { color: colourAt(spec, gi), dash, width: 1.5 },
          });
      }
    }
  }
  if (o.stats)
    notes.push(
      `lines: mean (solid) and median (dotted) per group${o.pseudolog_x ? ', of the pseudolog values' : ''}`,
    );
  const layout = baseLayout(spec, panels.length > 1 ? panels.map(([p]) => p) : [], {
    x,
    y: o.kind === 'histogram' ? 'count' : 'density',
  });
  layout.barmode = 'overlay';
  layout.shapes = shapes;
  if (o.p_values !== 'none') {
    const p = await pValueNotes(
      groupBy(kept, one(e, 'color')).map(([g, gr]) => [g, gr.map((r) => value.get(r)!)]),
      o.p_values as string,
      compute,
    );
    layout.annotations = [...((layout.annotations as unknown[]) ?? []), ...p.annotations];
    Object.assign(info, p.compute);
  }
  return { data, layout, rows: kept.length, dropped, transformations: notes, compute: info };
}

export function shapeLollipop(rows: Row[], spec: ChartSpec, o: O): Shaped {
  const e = enc(spec);
  const [label, x, size] = [one(e, 'rowLabel')!, one(e, 'x')!, one(e, 'size')];
  // v1 failed with "NULL values in dataframe": rows without a value are dropped and counted.
  const { kept, dropped } = complete(rows, [x, size], [label]);
  const notes: string[] = [];
  const vals = axisValues(
    kept.map((r) => num(r, x)),
    { z: o.standardize === 'x', log: o.pseudolog_x === true, base: o.pseudolog_base as number | undefined },
    x,
    notes,
  );
  let order = kept.map((_, i) => i);
  if (o.sort !== 'none')
    order = order.sort((a, b) => (o.sort === 'asc' ? vals[a]! - vals[b]! : vals[b]! - vals[a]!));
  const labels = order.map((i) => toLabel(kept[i]![label]));
  const values = order.map((i) => vals[i]!);
  const sv = size ? order.map((i) => num(kept[i]!, size)) : [];
  const [lo, hi] = [Math.min(...sv), Math.max(...sv)];
  const h = o.orientation === 'h';
  const stems = {
    type: 'scatter',
    mode: 'lines',
    showlegend: false,
    hoverinfo: 'skip',
    line: { color: '#9aa5b1', width: 2 },
    [h ? 'x' : 'y']: values.flatMap((v) => [0, v, null]),
    [h ? 'y' : 'x']: labels.flatMap((l) => [l, l, null]),
  };
  const colourCol = one(e, 'color');
  const groups = groupBy(
    order.map((i) => kept[i]!),
    colourCol,
  ).map(([g]) => g);
  const dots = {
    type: 'scatter',
    mode: 'markers',
    name: x,
    [h ? 'x' : 'y']: values,
    [h ? 'y' : 'x']: labels,
    marker: {
      size: size ? sv.map((v) => (hi > lo ? 6 + ((v - lo) / (hi - lo)) * 14 : 10)) : 10,
      color: colourCol
        ? order.map((i) => colourAt(spec, groups.indexOf(toLabel(kept[i]![colourCol]))))
        : colourAt(spec, 0),
    },
  };
  return {
    data: [stems, dots],
    layout: { ...baseLayout(spec, [], { x: h ? x : label, y: h ? label : x }), showlegend: false },
    rows: kept.length,
    dropped,
    transformations: notes,
    compute: {},
  };
}

export function shapePie(rows: Row[], spec: ChartSpec, o: O): Shaped {
  const e = enc(spec);
  const [cat, val] = [one(e, 'categories')!, one(e, 'values')!];
  const { kept, dropped } = complete(rows, [val], [cat]);
  // v1 drew blank pies for these: negative slices have no meaning.
  if (kept.some((r) => (toNumber(r[val]) ?? 0) < 0))
    throw dataError(
      'negative_values',
      'encodings.values',
      `${val} has negative values; a pie needs values ≥ 0.`,
    );
  const panels = facets(kept, one(e, 'panel'));
  const columns = Math.ceil(Math.sqrt(panels.length));
  const notes = [`slices = sum of ${val} per ${cat}`];
  if (o.pseudolog_values)
    notes.push(`slice values pseudolog base ${(o.pseudolog_base as number | undefined) ?? 10}`);
  const data = panels.map(([panel, pr], pi) => {
    const groups = groupBy(pr, cat);
    let values = groups.map(([, gr]) => gr.reduce((s, r) => s + num(r, val), 0));
    if (o.pseudolog_values)
      values = values.map((v) => pseudolog(v, (o.pseudolog_base as number | undefined) ?? 10));
    return {
      type: 'pie',
      labels: groups.map(([g]) => g),
      values,
      hole: o.hole,
      textinfo: o.textinfo,
      textposition: o.textposition,
      direction: o.direction,
      rotation: o.rotation,
      sort: o.sort,
      pull: o.pull,
      name: panel || cat,
      title: { text: panel },
      marker: { colors: groups.map((_, i) => colourAt(spec, i)) },
      ...(panels.length > 1 ? { domain: { row: Math.floor(pi / columns), column: pi % columns } } : {}),
    };
  });
  const layout: Record<string, unknown> = {
    showlegend: true,
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  if (panels.length > 1) layout.grid = { rows: Math.ceil(panels.length / columns), columns };
  return { data, layout, rows: kept.length, dropped, transformations: notes, compute: {} };
}
