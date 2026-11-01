import type { ChartSpec } from '@tributary/contracts';
import { dataError } from './errors.ts';
import { pseudolog, toLabel, toNumber, zscore } from './transforms.ts';

export type Row = Record<string, unknown>;
export type Enc = Record<string, string | string[] | undefined>;
export const enc = (spec: ChartSpec) => spec.encodings as Enc;
export const one = (e: Enc, slot: string) => e[slot] as string | undefined;

/** Layout palettes (spec.layout.palette). Okabe–Ito is colour-blind safe (Okabe & Ito 2008). */
const PALETTES: Record<string, string[]> = {
  default: [
    '#1f77b4',
    '#ff7f0e',
    '#2ca02c',
    '#d62728',
    '#9467bd',
    '#8c564b',
    '#e377c2',
    '#7f7f7f',
    '#bcbd22',
    '#17becf',
  ],
  colorblind: ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#cc79a7', '#56b4e9', '#f0e442', '#000000'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  greys: ['#252525', '#636363', '#969696', '#bdbdbd'],
};
export const colourAt = (spec: ChartSpec, i: number) => {
  const p = PALETTES[spec.layout.palette] ?? PALETTES.default!;
  return p[i % p.length]!;
};

/** Groups in first-appearance order (one group '' without a column). */
export function groupBy(rows: Row[], column: string | undefined): [string, Row[]][] {
  if (!column) return [['', rows]];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = toLabel(r[column]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups];
}

/** Drop rows missing a required numeric value (null policy drop-and-report). */
export function complete(rows: Row[], numeric: (string | undefined)[], labels: (string | undefined)[] = []) {
  const kept = rows.filter(
    (r) =>
      numeric.every((c) => !c || toNumber(r[c]) !== null) &&
      labels.every((c) => !c || (r[c] !== null && r[c] !== undefined && r[c] !== '')),
  );
  return { kept, dropped: rows.length - kept.length };
}

export const MAX_FACETS = 24;

/** Facets by the panel column, capped (REFERENCE_V1 §8: 100 panels broke v1's layout). */
export function facets(rows: Row[], panel: string | undefined): [string, Row[]][] {
  const groups = groupBy(rows, panel);
  if (groups.length > MAX_FACETS)
    throw dataError(
      'too_many_facets',
      'encodings.panel',
      `${groups.length} panels; at most ${MAX_FACETS}. Filter or pick another column.`,
    );
  return groups;
}

export const axisRefs = (i: number) =>
  i === 0 ? { xaxis: 'x', yaxis: 'y' } : { xaxis: `x${i + 1}`, yaxis: `y${i + 1}` };

/** Shared layout options (v1 parity): grid lines, shared axes, legends, titles; a grid for facets. */
export function baseLayout(
  spec: ChartSpec,
  panels: string[],
  titles: { x: string; y: string },
): Record<string, unknown> {
  const L = spec.layout;
  const layout: Record<string, unknown> = {
    showlegend: true,
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  const n = Math.max(panels.length, 1);
  for (let i = 0; i < n; i++) {
    const s = i === 0 ? '' : String(i + 1);
    layout[`xaxis${s}`] = {
      title: { text: i === 0 || !L.sharedX ? (spec.axes?.x?.title ?? titles.x) : '' },
      showgrid: L.gridX,
      ...(i > 0 && L.sharedX ? { matches: 'x' } : {}),
    };
    layout[`yaxis${s}`] = {
      title: { text: i === 0 || !L.sharedY ? (spec.axes?.y?.title ?? titles.y) : '' },
      showgrid: L.gridY,
      ...(i > 0 && L.sharedY ? { matches: 'y' } : {}),
    };
  }
  if (panels.length > 1) {
    const columns = Math.ceil(Math.sqrt(panels.length));
    layout.grid = { rows: Math.ceil(panels.length / columns), columns, pattern: 'independent' };
    layout.annotations = panels.map((p, i) => ({
      text: p,
      showarrow: false,
      xref: `${axisRefs(i).xaxis} domain`,
      yref: `${axisRefs(i).yaxis} domain`,
      x: 0.5,
      y: 1.08,
      font: { size: 12 },
    }));
  }
  return layout;
}

/** Legend entries: one per group across panels (shared legend) or one per panel trace. */
export const legend = (spec: ChartSpec, group: string, panelIndex: number, panel: string) =>
  spec.layout.sharedLegend
    ? { name: group, legendgroup: group, showlegend: panelIndex === 0 }
    : { name: panel ? `${group} (${panel})` : group, showlegend: true };

/** Numeric axis transforms recorded in provenance: z-score then pseudolog. */
export function axisValues(
  values: number[],
  o: { z?: boolean; log?: boolean; base?: number | undefined },
  name: string,
  notes: string[],
): number[] {
  let v = values;
  if (o.z) {
    const z = zscore(v);
    if (z.some((x) => x === null))
      throw dataError(
        'constant_vector',
        'options.standardize',
        `${name} does not vary, so it cannot be z-scored.`,
      );
    v = z as number[];
    notes.push(`${name} z-scored (sample SD)`);
  }
  if (o.log) {
    const base = o.base ?? 10;
    v = v.map((x) => pseudolog(x, base));
    notes.push(`${name} pseudolog base ${base}`);
  }
  return v;
}

export const num = (r: Row, c: string) => toNumber(r[c]) as number;
export { toLabel, toNumber };
