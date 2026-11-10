// Regulated proteins ranked by pEC50 (Phase 42, SEL-02). Display only: positions come from the source tool's pEC50.
import type { SelectivityProfile } from './profile.ts';

/** Proteins drawn (the table lists all). */
export const FIGURE_PROTEINS = 40;

const COLOURS = { primary_target: '#D55E00', off_target: '#E69F00', none: '#0072B2' } as const;
const NAMES = {
  primary_target: 'Annotated primary target',
  off_target: 'Annotated off-target',
  none: 'Other',
};
const SYMBOLS = { down: 'circle', up: 'triangle-up' } as const;

/** "1 µM", "100 nM": EC50 = 10^−pEC50 M, rounded to 3 significant figures before the unit is chosen. */
export function ec50Text(pec50: number): string {
  const molar = Number((10 ** -pec50).toPrecision(3));
  const [unit, factor] =
    molar >= 1e-3 ? ['mM', 1e3] : molar >= 1e-6 ? ['µM', 1e6] : molar >= 1e-9 ? ['nM', 1e9] : ['pM', 1e12];
  return `${Number((molar * factor).toPrecision(3))} ${unit}`;
}

export function selectivityFigure(p: SelectivityProfile) {
  const withPotency = p.proteins.filter((x) => x.pec50 !== null);
  const shown = withPotency.slice(0, FIGURE_PROTEINS);
  const label = (x: (typeof shown)[number]) =>
    x.genes ? `${x.genes.split('; ')[0]} (${x.feature_id})` : x.feature_id;
  // Most potent at the top.
  const order = shown.map(label).reverse();
  // One trace per annotation × direction, so the legend explains both colour and symbol.
  const groups = (['primary_target', 'off_target', 'none'] as const).flatMap((k) =>
    (['down', 'up'] as const).map((d) => ({
      k,
      d,
      rows: shown.filter((x) => (x.known ?? 'none') === k && x.regulation === d),
    })),
  );
  const threshold = p.s_score.pec50_min;
  return {
    data: groups
      .filter((g) => g.rows.length > 0)
      .map((g) => ({
        type: 'scatter',
        mode: 'markers',
        name: `${NAMES[g.k]} · ${g.d}`,
        x: g.rows.map((x) => x.pec50),
        y: g.rows.map(label),
        marker: { color: COLOURS[g.k], size: 9, symbol: SYMBOLS[g.d] },
        hovertemplate: `%{y}<br>pEC50 %{x:.2f} (${g.d})<extra></extra>`,
      })),
    layout: {
      title: {
        text:
          withPotency.length > FIGURE_PROTEINS
            ? `${FIGURE_PROTEINS} most potent of ${withPotency.length} regulated proteins with a pEC50 (the table lists all)`
            : `${withPotency.length} regulated protein(s) with a pEC50`,
        font: { size: 13 },
      },
      height: Math.max(260, 22 * shown.length + 140),
      margin: { l: 180, t: 60 },
      xaxis: { title: { text: 'pEC50 (−log10 EC50 in M)' }, zeroline: false },
      yaxis: { type: 'category', categoryorder: 'array', categoryarray: order, automargin: true },
      shapes: [
        {
          type: 'line',
          x0: threshold,
          x1: threshold,
          yref: 'paper',
          y0: 0,
          y1: 1,
          line: { dash: 'dash', color: '#52606D' },
        },
      ],
      annotations: [
        {
          x: threshold,
          y: 1,
          yref: 'paper',
          yanchor: 'bottom',
          showarrow: false,
          text: `S threshold: pEC50 ${threshold} (EC50 ${ec50Text(threshold)})`,
          font: { size: 11, color: '#52606D' },
        },
      ],
      legend: { orientation: 'h', y: -0.15 },
    },
  };
}
