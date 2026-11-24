import type { ChartSpec } from '@tributary/contracts';
import type { Compute } from './compute.ts';
import {
  baseLayout,
  colourAt,
  complete,
  enc,
  groupBy,
  num,
  one,
  toLabel,
  toNumber,
  type Row,
} from './common.ts';
import { dataError } from './errors.ts';
import { buildMatrix } from './matrix.ts';
import type { Shaped } from './volcano.ts';

type O = Record<string, unknown>;
const CLASS_COLOURS = { up: '#c0392b', down: '#2471a3', none: '#9aa5b1' };

/** MA plot: M (e.g. log2 FC) against A (mean log abundance); hits by |M| and, given z, adjusted p. */
export function shapeMa(rows: Row[], spec: ChartSpec, o: O): Shaped {
  const e = enc(spec);
  const [a, m, p, label] = [one(e, 'x')!, one(e, 'y')!, one(e, 'z'), one(e, 'label')];
  const { kept, dropped } = complete(rows, [a, m, p]);
  const fc = o.fc_threshold as number;
  const cls = (r: Row) => {
    const mv = num(r, m);
    const sig = Math.abs(mv) >= fc && (!p || num(r, p) <= (o.p_threshold as number));
    return !sig ? 'none' : mv > 0 ? 'up' : mv < 0 ? 'down' : 'none';
  };
  const groups = [
    ['up', 'Up'],
    ['down', 'Down'],
    ['none', 'Not significant'],
  ] as const;
  const data = groups.map(([key, name]) => {
    const gr = kept.filter((r) => cls(r) === key);
    return {
      type: o.webgl === false ? 'scatter' : 'scattergl',
      mode: 'markers',
      name: `${name} (${gr.length})`,
      x: gr.map((r) => num(r, a)),
      y: gr.map((r) => num(r, m)),
      customdata: gr.map((r) => [label ? toLabel(r[label]) : null, kept.indexOf(r)]),
      marker: { color: CLASS_COLOURS[key], size: 6 },
    };
  });
  const hits = kept
    .filter((r) => cls(r) !== 'none')
    .sort((x, y) => (p ? num(x, p) - num(y, p) : 0) || Math.abs(num(y, m)) - Math.abs(num(x, m)))
    .slice(0, label ? (o.label_top as number) : 0);
  const layout = baseLayout(spec, [], { x: a, y: m });
  layout.annotations = hits.map((r) => ({
    x: num(r, a),
    y: num(r, m),
    text: toLabel(r[label!]),
    showarrow: true,
    arrowhead: 0,
    ax: 0,
    ay: -18,
    font: { size: 11 },
  }));
  layout.shapes = [-fc, fc, 0].map((y0) => ({
    type: 'line',
    xref: 'paper',
    x0: 0,
    x1: 1,
    y0,
    y1: y0,
    line: { color: '#57606a', dash: y0 ? 'dash' : 'solid', width: 1 },
  }));
  layout.dragmode = 'lasso';
  const rule = `hit: |${m}| ≥ ${fc}${p ? ` and ${p} ≤ ${o.p_threshold as number}` : ' (no p column)'}`;
  return { data, layout, rows: kept.length, dropped, transformations: [rule], compute: {} };
}

/** PCA of observations (rowLabel) × features (values columns, or x categories of long data) via apps/compute. */
export async function shapePca(rows: Row[], spec: ChartSpec, o: O, compute: Compute): Promise<Shaped> {
  const e = enc(spec);
  const m = buildMatrix(rows, spec, false);
  // No imputation: features with a missing value in any observation are left out and counted.
  const completeCols = m.colLabels.map((_, j) => m.z.every((row) => row[j] !== null));
  const leftOut = completeCols.filter((c) => !c).length;
  const z = m.z.map((row) => row.filter((_, j) => completeCols[j]) as number[]);
  const features = z[0]?.length ?? 0;
  if (m.rowLabels.length < 2 || features < 2)
    throw dataError(
      'too_few_rows',
      'encodings.values',
      `PCA needs at least 2 observations and 2 complete features (${m.rowLabels.length} × ${features}).`,
    );
  const res = await compute.pca({ values: z, scale: o.scale, components: o.components });
  const [px, py] = [(o.pc_x as number) - 1, (o.pc_y as number) - 1];
  const colourCol = one(e, 'color');
  const colourOf = new Map(
    rows.map((r) => [toLabel(r[one(e, 'rowLabel')!]), colourCol ? toLabel(r[colourCol]) : '']),
  );
  const groups = [...new Set(m.rowLabels.map((l) => colourOf.get(l) ?? ''))];
  const data = groups.map((g, gi) => {
    const ix = m.rowLabels.flatMap((l, i) => ((colourOf.get(l) ?? '') === g ? [i] : []));
    return {
      type: 'scatter',
      mode: 'markers+text',
      name: g || 'observations',
      x: ix.map((i) => res.scores[i]![px]),
      y: ix.map((i) => res.scores[i]![py]),
      text: ix.map((i) => m.rowLabels[i]),
      textposition: 'top center',
      marker: { size: 10, color: colourAt(spec, gi) },
    };
  });
  const pct = (k: number) => `PC${k + 1} (${(res.explained_variance_ratio[k]! * 100).toFixed(1)}%)`;
  const transformations = [
    `PCA on ${m.rowLabels.length} observations × ${features} features (centred${o.scale ? ', unit variance' : ''})`,
    ...(leftOut ? [`${leftOut} feature(s) with missing values left out (no imputation)`] : []),
  ];
  return {
    data,
    layout: baseLayout(spec, [], { x: pct(px), y: pct(py) }),
    rows: m.rowLabels.length,
    dropped: 0,
    transformations,
    compute: { pca: res.compute_version },
  };
}

/** QC panel (SPEC M7): IDs per run, missing values per run, CVs per feature, intensity distributions. */
export async function shapeQc(rows: Row[], spec: ChartSpec, o: O, compute: Compute): Promise<Shaped> {
  const e = enc(spec);
  const [run, feature, value, group] = [
    one(e, 'x')!,
    one(e, 'rowLabel')!,
    one(e, 'values')!,
    one(e, 'color'),
  ];
  // Rows without a run or feature cannot be placed: left out and counted. Values that are missing or ≤ 0 count as
  // "not quantified" in every panel (tools such as DIA-NN and MaxQuant write 0 for not quantified).
  const placed = rows.filter(
    (r) => r[run] != null && r[run] !== '' && r[feature] != null && r[feature] !== '',
  );
  // Imputed values (is_imputed, when the dataset has it) are not measurements: not quantified either.
  const imputed = placed.filter((r) => r['is_imputed'] === true).length;
  const quantified = (r: Row) => r['is_imputed'] !== true && (toNumber(r[value]) ?? 0) > 0;
  const present = placed.filter(quantified);
  const runs = groupBy(placed, run);
  const allFeatures = new Set(placed.map((r) => toLabel(r[feature])));
  const panels: { title: string; traces: Record<string, unknown>[]; y: string }[] = [];
  const notes: string[] = [];
  const info: Record<string, string> = {};
  if (imputed) notes.push(`${imputed} imputed value(s) counted as not quantified (left out of every panel)`);
  if (o.show_ids) {
    const ids = runs.map(([, rr]) => new Set(rr.filter(quantified).map((r) => toLabel(r[feature]))).size);
    panels.push({
      title: 'IDs per run',
      y: 'features',
      traces: [
        {
          type: 'bar',
          name: 'IDs per run',
          x: runs.map(([k]) => k),
          y: ids,
          marker: { color: colourAt(spec, 0) },
        },
      ],
    });
  }
  if (o.show_completeness) {
    const missing = runs.map(([, rr]) => {
      const seen = new Set(rr.filter(quantified).map((r) => toLabel(r[feature]))).size;
      return Number((((allFeatures.size - seen) / allFeatures.size) * 100).toFixed(2));
    });
    panels.push({
      title: 'Missing values (%)',
      y: '% of features',
      traces: [
        {
          type: 'bar',
          name: 'Missing values (%)',
          x: runs.map(([k]) => k),
          y: missing,
          marker: { color: colourAt(spec, 1) },
        },
      ],
    });
  }
  if (o.show_cv) {
    // CV of linear intensities per feature within each colour group (or across all runs); n < 2 → no CV. With a
    // group, runs without one (e.g. not in a joined sample sheet) form their own labelled group, never "all runs".
    const UNMATCHED = 'not in the sample sheet';
    const label = (g: string) => (group ? g || UNMATCHED : 'all runs');
    const groups = groupBy(present, group).flatMap(([g, gr]) =>
      groupBy(gr, feature).map(([f, fr]) => ({
        name: `${g}\u0000${f}`,
        values: fr.map((r) => num(r, value)),
      })),
    );
    const summary = await compute.groupSummary({ groups });
    info.group_summary = summary.compute_version;
    const cvs = summary.groups.filter((s) => s.cv !== null);
    panels.push({
      title: 'CV (%)',
      y: 'CV (%)',
      traces: [
        {
          type: 'box',
          name: 'CV (%)',
          x: cvs.map((s) => label(s.name.split('\u0000')[0]!)),
          y: cvs.map((s) => s.cv! * 100),
          boxpoints: false,
          marker: { color: colourAt(spec, 2) },
        },
      ],
    });
    const none = summary.groups.length - cvs.length;
    if (group) {
      const by = group.replace(/^[a-z][a-z0-9_]*\./, '');
      const withCv = new Set(cvs.map((s) => s.name.split('\u0000')[0]!));
      const without = [...new Set(summary.groups.map((s) => s.name.split('\u0000')[0]!))]
        .filter((g) => !withCv.has(g))
        .map(label);
      notes.push(
        `CV = SD / mean of linear ${value} per feature within ${by}; ${none} feature–${by} pair(s) with < 2 quantified values have no CV${
          without.length ? `; no CV for: ${without.join(', ')}` : ''
        }`,
      );
      const unmatched = runs.filter(([, rr]) => rr.every((r) => r[group] == null || r[group] === '')).length;
      if (unmatched)
        notes.push(`${unmatched} run(s) not in the sample sheet: their CVs form a separate group`);
    } else
      notes.push(
        `CV = SD / mean of linear ${value} per feature across all runs; ${none} feature(s) with < 2 values have none`,
      );
  }
  if (o.show_intensity) {
    const usable = present;
    const name = o.log2 ? `log2 ${value === 'intensity' ? 'intensity' : value}` : value;
    panels.push({
      title: o.log2 ? 'log2 intensity' : 'intensity',
      y: name,
      traces: [
        {
          type: 'box',
          name: o.log2 ? 'log2 intensity' : 'intensity',
          x: usable.map((r) => toLabel(r[run])),
          y: usable.map((r) => (o.log2 ? Math.log2(num(r, value)) : num(r, value))),
          boxpoints: false,
          marker: { color: colourAt(spec, 3) },
        },
      ],
    });
  }
  const data = panels.flatMap((p, i) =>
    p.traces.map((t) => ({
      ...t,
      xaxis: i ? `x${i + 1}` : 'x',
      yaxis: i ? `y${i + 1}` : 'y',
      showlegend: false,
    })),
  );
  const layout: Record<string, unknown> = {
    grid: { rows: Math.ceil(panels.length / 2), columns: Math.min(2, panels.length), pattern: 'independent' },
    annotations: panels.map((p, i) => ({
      text: p.title,
      showarrow: false,
      xref: `${i ? `x${i + 1}` : 'x'} domain`,
      yref: `${i ? `y${i + 1}` : 'y'} domain`,
      x: 0.5,
      y: 1.12,
      font: { size: 13 },
    })),
    showlegend: false,
    height: panels.length > 2 ? 760 : 420,
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  panels.forEach((p, i) => {
    layout[`yaxis${i ? i + 1 : ''}`] = { title: { text: p.y }, showgrid: spec.layout.gridY };
    layout[`xaxis${i ? i + 1 : ''}`] = { showgrid: spec.layout.gridX, tickangle: -45 };
  });
  return {
    data,
    layout,
    rows: present.length,
    dropped: rows.length - present.length,
    transformations: notes,
    compute: info,
  };
}
