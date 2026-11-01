import type { ChartSpec, VolcanoOptions } from '@tributary/contracts';
import { dataError } from './errors.ts';
import { pseudolog, toLabel, toNumber, zscore } from './transforms.ts';

type Row = Record<string, unknown>;
export interface Shaped {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
  rows: number;
  dropped: number;
  transformations: string[];
  compute: Record<string, string | number>;
}

const CLASS_COLOURS = { up: '#c0392b', down: '#2471a3', none: '#9aa5b1' };

/** Volcano: effect (x) against −log10 p (y), hits by |x| ≥ fc and p ≤ p threshold (SPEC M7 omics preset). */
export function shapeVolcano(rows: Row[], spec: ChartSpec, o: VolcanoOptions): Shaped {
  const enc = spec.encodings as Record<string, string | string[] | undefined>;
  const xCol = enc.x as string;
  const yCol = enc.y as string;
  const label = enc.label as string | undefined;
  const hover = ([] as string[]).concat(enc.hover ?? []);
  const transformations: string[] = [];

  // Null policy drop-and-report: rows without x or y are not plotted and are counted.
  const kept = rows
    .map((r, i) => ({ r, i, x: toNumber(r[xCol]), p: toNumber(r[yCol]) }))
    .filter((p): p is { r: Row; i: number; x: number; p: number } => p.x !== null && p.p !== null);
  if (o.y_transform === 'neg_log10' && kept.some((k) => !(k.p > 0 && k.p <= 1)))
    throw dataError(
      'p_out_of_range',
      'encodings.y',
      `"${yCol}" has values outside (0, 1]; −log10 needs p-values.`,
    );

  let xs = kept.map((k) => k.x);
  if (o.standardize_x) {
    const z = zscore(xs);
    if (z.some((v) => v === null))
      throw dataError(
        'constant_vector',
        'options.standardize_x',
        `"${xCol}" does not vary, so it cannot be z-scored.`,
      );
    xs = z as number[];
    transformations.push(`x z-scored (sample SD) over ${xs.length} rows`);
  }
  const base = o.pseudolog_base ?? 10;
  if (o.pseudolog_x) {
    xs = xs.map((v) => pseudolog(v, base));
    transformations.push(`x pseudolog base ${base}`);
  }
  let ys = kept.map((k) => (o.y_transform === 'neg_log10' ? -Math.log10(k.p) : k.p));
  if (o.y_transform === 'neg_log10') transformations.push(`y = −log10(${yCol})`);
  if (o.pseudolog_y) {
    ys = ys.map((v) => pseudolog(v, base));
    transformations.push(`y pseudolog base ${base}`);
  }

  // Hits use the untransformed effect and p (thresholds are in the data's units).
  const significant = (k: (typeof kept)[number]) =>
    o.y_transform === 'neg_log10' ? k.p <= o.p_threshold : k.p >= -Math.log10(o.p_threshold);
  const classOf = (k: (typeof kept)[number], x: number) =>
    !significant(k)
      ? 'none'
      : x >= o.fc_threshold && x > 0
        ? 'up'
        : x <= -o.fc_threshold && x < 0
          ? 'down'
          : 'none';
  const classes = kept.map((k, j) => classOf(k, o.standardize_x ? xs[j]! : k.x));

  const groups: { key: 'up' | 'down' | 'none'; name: string }[] = [
    { key: 'up', name: 'Up' },
    { key: 'down', name: 'Down' },
    { key: 'none', name: 'Not significant' },
  ];
  const data = groups.map(({ key, name }) => {
    const idx = classes.flatMap((c, j) => (c === key ? [j] : []));
    return {
      type: o.webgl ? 'scattergl' : 'scatter',
      mode: 'markers',
      name: `${name} (${idx.length})`,
      x: idx.map((j) => xs[j]),
      y: idx.map((j) => ys[j]),
      // [label, row index in the query result, ...hover values]: the row index drives lasso → rows.
      customdata: idx.map((j) => [
        label ? toLabel(kept[j]!.r[label]) : null,
        kept[j]!.i,
        ...hover.map((h) => toLabel(kept[j]!.r[h])),
      ]),
      hovertemplate:
        `${label ? '%{customdata[0]}<br>' : ''}${xCol}: %{x:.3g}<br>${o.y_transform === 'neg_log10' ? `−log10 ${yCol}` : yCol}: %{y:.3g}` +
        hover.map((h, n) => `<br>${h}: %{customdata[${n + 2}]}`).join('') +
        '<extra></extra>',
      marker: {
        color: CLASS_COLOURS[key],
        size: 6,
        ...(enc.opacity ? { opacity: idx.map((j) => toNumber(kept[j]!.r[enc.opacity as string]) ?? 1) } : {}),
      },
    };
  });

  // Threshold lines live in the plotted space: y is −log10(p) in both modes, then any pseudolog.
  // Known-target overlay: ids matched against any accession of the label (protein groups are ";"-joined).
  // Isoforms (P04637-2) match their canonical accession.
  const canonical = (id: string) => id.trim().replace(/-\d+$/, '');
  const wanted = new Set((o.highlight ?? []).map(canonical));
  if (wanted.size && label) {
    const idx = kept.flatMap((k, j) =>
      toLabel(k.r[label])
        .split(';')
        .some((id) => wanted.has(canonical(id)))
        ? [j]
        : [],
    );
    const found = new Set(
      idx.flatMap((j) =>
        toLabel(kept[j]!.r[label])
          .split(';')
          .map(canonical)
          .filter((id) => wanted.has(id)),
      ),
    );
    data.push({
      type: o.webgl ? 'scattergl' : 'scatter',
      mode: 'markers',
      name: `${o.highlight_label} (${idx.length})`,
      x: idx.map((j) => xs[j]),
      y: idx.map((j) => ys[j]),
      customdata: idx.map((j) => [toLabel(kept[j]!.r[label]), kept[j]!.i]),
      hovertemplate: '%{customdata[0]}<extra>' + o.highlight_label + '</extra>',
      marker: { color: 'rgba(0,0,0,0)', size: 11, line: { color: '#e6a100', width: 2.5 } },
    } as (typeof data)[number]);
    transformations.push(`${o.highlight_label}: ${found.size} of ${wanted.size} highlighted ids found`);
  }

  const yLine = o.pseudolog_y ? pseudolog(-Math.log10(o.p_threshold), base) : -Math.log10(o.p_threshold);
  const xLine = (v: number) => (o.pseudolog_x ? pseudolog(v, base) : v);
  const line = { color: '#57606a', dash: 'dash', width: 1 };
  const shapes = [
    ...(o.fc_threshold > 0
      ? [-1, 1].map((s) => ({
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: xLine(s * o.fc_threshold),
          x1: xLine(s * o.fc_threshold),
          y0: 0,
          y1: 1,
          line,
        }))
      : []),
    { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: yLine, y1: yLine, line },
  ];
  const hits = kept
    .map((k, j) => ({ k, j }))
    .filter(({ j }) => classes[j] !== 'none')
    // Most significant first: smallest p, or largest y when y is already −log10(p).
    .sort(
      (a, b) =>
        (o.y_transform === 'neg_log10' ? a.k.p - b.k.p : b.k.p - a.k.p) || Math.abs(b.k.x) - Math.abs(a.k.x),
    )
    .slice(0, label ? o.label_top : 0);
  const annotations = hits.map(({ k, j }) => ({
    x: xs[j],
    y: ys[j],
    text: toLabel(k.r[label!]),
    showarrow: true,
    arrowhead: 0,
    ax: 0,
    ay: -18,
    font: { size: 11 },
  }));
  const axes = spec.axes ?? {};
  return {
    data,
    layout: {
      xaxis: { title: { text: axes.x?.title ?? xCol }, showgrid: spec.layout.gridX, zeroline: false },
      yaxis: {
        title: { text: axes.y?.title ?? (o.y_transform === 'neg_log10' ? `−log10(${yCol})` : yCol) },
        showgrid: spec.layout.gridY,
      },
      shapes,
      annotations,
      showlegend: true,
      dragmode: 'lasso',
      ...(spec.title ? { title: { text: spec.title } } : {}),
    },
    rows: kept.length,
    dropped: rows.length - kept.length,
    transformations,
    compute: {},
  };
}
