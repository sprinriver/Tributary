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

type O = Record<string, unknown>;
const symbols = ['circle', 'square', 'diamond', 'triangle-up', 'x', 'cross', 'star', 'triangle-down'];

/** Centred moving average (display smoothing, recorded in provenance). */
function movingAverage(v: number[], w: number): number[] {
  const h = Math.floor(w / 2);
  return v.map((_, i) => {
    const part = v.slice(Math.max(0, i - h), Math.min(v.length, i + h + 1));
    return part.reduce((a, b) => a + b, 0) / part.length;
  });
}

/** p-value annotations from apps/compute (exploratory; method and BH adjustment named). */
export async function pValueNotes(groups: [string, number[]][], method: string, compute: Compute) {
  const res = await compute.groupTest({ groups: groups.map(([name, values]) => ({ name, values })), method });
  const label =
    {
      anova: 'ANOVA',
      kruskal: 'Kruskal–Wallis',
      welch_t: 'Welch t',
      mann_whitney: 'Mann–Whitney U',
      ks: 'KS',
    }[method] ?? method;
  const lines =
    res.overall_p !== null
      ? [`${label} p = ${res.overall_p.toPrecision(3)}`]
      : res.comparisons.map(
          (c) =>
            `${c.group} vs ${c.reference} (${label}): p = ${c.p.toPrecision(3)}, p_adj = ${c.p_adj.toPrecision(3)} (${res.adj_method})`,
        );
  return {
    annotations: lines.map((text, i) => ({
      text,
      xref: 'paper',
      yref: 'paper',
      x: 0,
      y: 1.12 + i * 0.06,
      showarrow: false,
      xanchor: 'left',
      font: { size: 11 },
    })),
    compute: { group_test: `${res.method}; ${res.compute_version}` },
  };
}

export function shapeLine(rows: Row[], spec: ChartSpec, o: O): Shaped {
  const e = enc(spec);
  const [x, y] = [one(e, 'x')!, one(e, 'y')!];
  const temporal = rows.some((r) => typeof r[x] === 'string' && toNumber(r[x]) === null);
  if (temporal && o.pseudolog_x)
    throw dataError('not_numeric', 'options.pseudolog_x', `${x} is a date; pseudolog needs numbers.`);
  const { kept, dropped } = complete(rows, [temporal ? undefined : x, y], [temporal ? x : undefined]);
  const notes: string[] = [];
  const panels = facets(kept, one(e, 'panel'));
  const data = panels.flatMap(([panel, pr], pi) =>
    groupBy(pr, one(e, 'color')).map(([group, gr], gi) => {
      const sorted = [...gr].sort((a, b) =>
        temporal ? String(a[x]).localeCompare(String(b[x])) : num(a, x) - num(b, x),
      );
      let ys = axisValues(
        sorted.map((r) => num(r, y)),
        {
          z: o.standardize === 'y',
          log: o.pseudolog_y === true,
          base: o.pseudolog_base as number | undefined,
        },
        // z-scores are per series (each colour group in each panel).
        `${y} (per series)`,
        pi || gi ? [] : notes,
      );
      if (o.smoothing === 'moving_average') {
        const w = (o.window as number | undefined) ?? 5;
        ys = movingAverage(ys, w);
        if (!pi && !gi)
          notes.push(
            `${y} centred moving average, window ${w} (shorter at the ends; x spacing not weighted)`,
          );
      }
      const xs = temporal
        ? sorted.map((r) => String(r[x]))
        : axisValues(
            sorted.map((r) => num(r, x)),
            { log: o.pseudolog_x === true, base: o.pseudolog_base as number | undefined },
            x,
            pi || gi ? [] : notes,
          );
      return {
        type: 'scatter',
        mode: o.point_label ? 'lines+markers+text' : 'lines+markers',
        x: xs,
        y: ys,
        ...(o.point_label
          ? { text: sorted.map((r) => toLabel(r[one(e, 'label')!])), textposition: 'top center' }
          : {}),
        line: { color: colourAt(spec, gi) },
        marker: {
          color: colourAt(spec, gi),
          ...(one(e, 'shape')
            ? {
                symbol: sorted.map(
                  (r) => symbols[Math.abs(hash(toLabel(r[one(e, 'shape')!]))) % symbols.length],
                ),
              }
            : {}),
          ...(one(e, 'opacity') ? { opacity: sorted.map((r) => toNumber(r[one(e, 'opacity')!]) ?? 1) } : {}),
        },
        ...legend(spec, group || y, pi, panel),
        ...axisRefs(pi),
      };
    }),
  );
  return {
    data,
    layout: baseLayout(spec, panels.length > 1 ? panels.map(([p]) => p) : [], { x, y }),
    rows: kept.length,
    dropped,
    transformations: notes,
    compute: {},
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

function aggregate(values: number[], how: string): number {
  if (how === 'count') return values.length;
  if (how === 'sum') return values.reduce((a, b) => a + b, 0);
  if (how === 'median') {
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  }
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function shapeBar(rows: Row[], spec: ChartSpec, o: O, compute: Compute): Promise<Shaped> {
  const e = enc(spec);
  const [x, y] = [one(e, 'x')!, one(e, 'y')!];
  const { kept, dropped } = complete(rows, [y], [x]);
  const notes: string[] = [];
  const z = axisValues(
    kept.map((r) => num(r, y)),
    { z: o.standardize === 'y' },
    y,
    notes,
  );
  const yOf = new Map(kept.map((r, i) => [r, z[i]!]));
  const categories = groupBy(kept, x).map(([c]) => c);
  const panels = facets(kept, one(e, 'panel'));
  const info: Record<string, string> = {};
  const data: Record<string, unknown>[] = [];
  for (const [pi, [panel, pr]] of panels.entries()) {
    for (const [gi, [group, gr]] of groupBy(pr, one(e, 'color')).entries()) {
      const byX = new Map(groupBy(gr, x).map(([c, cr]) => [c, cr.map((r) => yOf.get(r)!)]));
      const cats = categories.filter((c) => byX.has(c));
      let heights = cats.map((c) => aggregate(byX.get(c)!, o.aggregate as string));
      let errors: number[] | undefined;
      if (o.error_bars !== 'none') {
        const s = await compute.groupSummary({ groups: cats.map((c) => ({ name: c, values: byX.get(c)! })) });
        info.group_summary = s.compute_version;
        errors = s.groups.map(
          (g) => (o.error_bars === 'sd' ? g.sd : o.error_bars === 'sem' ? g.sem : g.ci95) ?? 0,
        );
      }
      if (o.pseudolog_y)
        heights = heights.map((h) => pseudolog(h, (o.pseudolog_base as number | undefined) ?? 10));
      const h = o.orientation === 'h';
      data.push({
        type: 'bar',
        orientation: o.orientation,
        [h ? 'y' : 'x']: cats,
        [h ? 'x' : 'y']: heights,
        ...(errors ? { [h ? 'error_x' : 'error_y']: { type: 'data', array: errors, visible: true } } : {}),
        ...(o.point_label
          ? { text: heights.map((v) => Number(v.toPrecision(3)).toString()), textposition: 'auto' }
          : {}),
        marker: { color: colourAt(spec, gi) },
        ...legend(spec, group || y, pi, panel),
        ...axisRefs(pi),
      });
    }
  }
  if (o.pseudolog_y)
    notes.push(`bar heights pseudolog base ${(o.pseudolog_base as number | undefined) ?? 10}`);
  notes.push(`bars = ${o.aggregate} of ${y} per ${x}`);
  const layout = baseLayout(spec, panels.length > 1 ? panels.map(([p]) => p) : [], {
    x: o.orientation === 'h' ? y : x,
    y: o.orientation === 'h' ? x : y,
  });
  layout.barmode = 'group';
  if (o.p_values !== 'none') {
    const p = await pValueNotes(
      groupBy(kept, x).map(([c, cr]) => [c, cr.map((r) => yOf.get(r)!)]),
      o.p_values as string,
      compute,
    );
    layout.annotations = [...((layout.annotations as unknown[]) ?? []), ...p.annotations];
    Object.assign(info, p.compute);
  }
  return { data, layout, rows: kept.length, dropped, transformations: notes, compute: info };
}

export function shapeScatter(rows: Row[], spec: ChartSpec, o: O, three = false): Shaped {
  const e = enc(spec);
  const [x, y, zc] = [one(e, 'x')!, one(e, 'y')!, one(e, 'z')];
  const categoricalX =
    !three && rows.some((r) => r[x] !== null && r[x] !== undefined && toNumber(r[x]) === null);
  if (categoricalX && (o.pseudolog_x || o.standardize === 'x' || o.standardize === 'both'))
    throw dataError('not_numeric', 'options.standardize', `${x} is categorical; it cannot be transformed.`);
  const { kept, dropped } = complete(
    rows,
    [categoricalX ? undefined : x, y, zc],
    [categoricalX ? x : undefined],
  );
  const notes: string[] = [];
  const base = o.pseudolog_base as number | undefined;
  const zAll = three ? o.standardize === 'all' : false;
  const val = (col: string, sz: boolean, log: unknown) =>
    axisValues(
      kept.map((r) => num(r, col)),
      { z: sz, log: log === true, base },
      col,
      notes,
    );
  const xs = categoricalX
    ? kept.map((r) => toLabel(r[x]))
    : val(x, zAll || o.standardize === 'x' || o.standardize === 'both', o.pseudolog_x);
  const ys = val(y, zAll || o.standardize === 'y' || o.standardize === 'both', o.pseudolog_y);
  const zs = zc ? val(zc, zAll, o.pseudolog_z) : [];
  const index = new Map(kept.map((r, i) => [r, i]));
  const panels = three ? ([['', kept]] as [string, Row[]][]) : facets(kept, one(e, 'panel'));
  const data = panels.flatMap(([panel, pr], pi) =>
    groupBy(pr, one(e, 'color')).map(([group, gr], gi) => {
      const ix = gr.map((r) => index.get(r)!);
      return {
        type: three ? 'scatter3d' : o.webgl === false ? 'scatter' : 'scattergl',
        mode: o.point_label ? 'markers+text' : 'markers',
        x: ix.map((i) => xs[i]),
        y: ix.map((i) => ys[i]),
        ...(three ? { z: ix.map((i) => zs[i]) } : {}),
        ...(o.point_label
          ? { text: gr.map((r) => toLabel(r[one(e, 'label')!])), textposition: 'top center' }
          : {}),
        customdata: gr.map((r, k) => [one(e, 'label') ? toLabel(r[one(e, 'label')!]) : null, ix[k]]),
        marker: {
          color: colourAt(spec, gi),
          size: three ? 4 : 7,
          ...(one(e, 'shape')
            ? {
                symbol: gr.map((r) => symbols[Math.abs(hash(toLabel(r[one(e, 'shape')!]))) % symbols.length]),
              }
            : {}),
          ...(one(e, 'opacity') ? { opacity: gr.map((r) => toNumber(r[one(e, 'opacity')!]) ?? 1) } : {}),
        },
        ...legend(spec, group || y, pi, panel),
        ...(three ? {} : axisRefs(pi)),
      };
    }),
  );
  const layout = three
    ? {
        scene: {
          xaxis: { title: { text: x } },
          yaxis: { title: { text: y } },
          zaxis: { title: { text: zc } },
        },
        showlegend: true,
        ...(spec.title ? { title: { text: spec.title } } : {}),
      }
    : { ...baseLayout(spec, panels.length > 1 ? panels.map(([p]) => p) : [], { x, y }), dragmode: 'lasso' };
  return { data, layout, rows: kept.length, dropped, transformations: notes, compute: {} };
}

export function shapeBubble(rows: Row[], spec: ChartSpec, o: O): Shaped {
  const e = enc(spec);
  const [x, y, s] = [one(e, 'x')!, one(e, 'y')!, one(e, 'size')!];
  const { kept, dropped } = complete(rows, [x, y, s]);
  const notes: string[] = [];
  const base = o.pseudolog_base as number | undefined;
  const xs = axisValues(
    kept.map((r) => num(r, x)),
    { z: o.standardize === 'x' || o.standardize === 'both', log: o.pseudolog_x === true, base },
    x,
    notes,
  );
  const ys = axisValues(
    kept.map((r) => num(r, y)),
    { z: o.standardize === 'y' || o.standardize === 'both', log: o.pseudolog_y === true, base },
    y,
    notes,
  );
  const sv = kept.map((r) => num(r, s));
  const [lo, hi] = [Math.min(...sv), Math.max(...sv)];
  const [mn, mx] = [o.size_min as number, o.size_max as number];
  // Diameters linear in the size value between size_min and size_max (a constant size → size_min).
  const sizes = sv.map((v) => (hi > lo ? mn + ((v - lo) / (hi - lo)) * (mx - mn) : mn));
  const index = new Map(kept.map((r, i) => [r, i]));
  const panels = facets(kept, one(e, 'panel'));
  const data = panels.flatMap(([panel, pr], pi) =>
    groupBy(pr, one(e, 'color')).map(([group, gr], gi) => {
      const ix = gr.map((r) => index.get(r)!);
      return {
        type: 'scatter',
        mode: 'markers',
        x: ix.map((i) => xs[i]),
        y: ix.map((i) => ys[i]),
        marker: {
          size: ix.map((i) => sizes[i]),
          sizemode: 'diameter',
          color: colourAt(spec, gi),
          opacity: 0.7,
        },
        ...legend(spec, group || s, pi, panel),
        ...axisRefs(pi),
      };
    }),
  );
  return {
    data,
    layout: baseLayout(spec, panels.length > 1 ? panels.map(([p]) => p) : [], { x, y }),
    rows: kept.length,
    dropped,
    transformations: notes,
    compute: {},
  };
}
