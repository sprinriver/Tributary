// Engaged proteins ranked by pEC50 (Phase 42, SEL-02). Display only: positions come from the source tool's pEC50.
import type { SelectivityProfile } from './profile.ts';

/** Proteins drawn (the table lists all). */
export const FIGURE_PROTEINS = 40;

const COLOURS = { primary_target: '#D55E00', off_target: '#E69F00', none: '#0072B2' } as const;
const NAMES = {
  primary_target: 'Annotated primary target',
  off_target: 'Annotated off-target',
  none: 'Other',
};

export function selectivityFigure(p: SelectivityProfile) {
  const shown = p.proteins.filter((x) => x.pec50 !== null).slice(0, FIGURE_PROTEINS);
  const label = (x: (typeof shown)[number]) =>
    x.genes ? `${x.genes.split('; ')[0]} (${x.feature_id})` : x.feature_id;
  // Most potent at the top.
  const order = shown.map(label).reverse();
  const groups = (['primary_target', 'off_target', 'none'] as const)
    .map((k) => ({ k, rows: shown.filter((x) => (x.known ?? 'none') === k) }))
    .filter((g) => g.rows.length > 0);
  return {
    data: groups.map((g) => ({
      type: 'scatter',
      mode: 'markers',
      name: NAMES[g.k],
      x: g.rows.map((x) => x.pec50),
      y: g.rows.map(label),
      marker: {
        color: COLOURS[g.k],
        size: 9,
        symbol: g.rows.map((x) => (x.regulation === 'up' ? 'triangle-up' : 'circle')),
      },
      customdata: g.rows.map((x) => x.regulation),
      hovertemplate: '%{y}<br>pEC50 %{x:.2f} (%{customdata})<extra></extra>',
    })),
    layout: {
      height: Math.max(260, 22 * shown.length + 120),
      margin: { l: 180 },
      xaxis: { title: { text: 'pEC50 (−log10 EC50 in M)' }, zeroline: false },
      yaxis: { type: 'category', categoryorder: 'array', categoryarray: order, automargin: true },
      shapes: [
        {
          type: 'line',
          x0: p.s_score.pec50_min,
          x1: p.s_score.pec50_min,
          yref: 'paper',
          y0: 0,
          y1: 1,
          line: { dash: 'dash', color: '#52606D' },
        },
      ],
      legend: { orientation: 'h', y: -0.15 },
    },
  };
}
