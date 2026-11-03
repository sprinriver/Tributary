// Dot plot of enrichment results (Phase 24, ENR-04): top terms by p-value; x = −log10(term adjusted p),
// dot size = hits in the set, colour = fold enrichment. Display transforms only; the statistics come from compute.
import type { EnrichmentTerm } from '@tributary/contracts';

export const FIGURE_TERMS = 20;
/** Term-level FDR drawn as the reference line (BH-adjusted p of the gene sets, not the hit threshold). */
export const TERM_FDR = 0.05;
/** −log10 of a p floored at the smallest positive double stays finite (≈ 323.3). */
const neglog10 = (p: number) => -Math.log10(Math.max(p, Number.MIN_VALUE));

/** `hitAdjPMax` is the feature-level hit threshold: shown as a caption, never as the reference line. */
export function enrichmentFigure(terms: EnrichmentTerm[], hitAdjPMax?: number) {
  const termFdr = TERM_FDR;
  const top = terms.slice(0, FIGURE_TERMS).reverse(); // best term at the top of the y axis
  const label = (t: EnrichmentTerm) => (t.name.length > 60 ? `${t.name.slice(0, 57)}…` : t.name);
  const x = top.map((t) => neglog10(t.adj_p_value));
  return {
    data: [
      {
        type: 'scatter',
        mode: 'markers',
        name: 'gene sets',
        x,
        y: top.map(label),
        customdata: top.map((t) => [t.id, t.overlap, t.size, t.fold_enrichment, t.adj_p_value]),
        marker: {
          size: top.map((t) => 8 + 2 * Math.sqrt(t.overlap)),
          color: top.map((t) => t.fold_enrichment),
          colorscale: 'Viridis',
          showscale: true,
          colorbar: { title: { text: 'fold enrichment' } },
        },
        hovertemplate:
          '%{y}<br>%{customdata[0]}<br>hits %{customdata[1]} of %{customdata[2]}' +
          '<br>fold %{customdata[3]:.3g}<br>adjusted p %{customdata[4]:.3g}<extra></extra>',
      },
    ],
    layout: {
      xaxis: { title: { text: '−log10(term adjusted p)' }, rangemode: 'tozero' },
      yaxis: { automargin: true },
      height: Math.max(300, 26 * top.length + 120),
      showlegend: false,
      shapes: [
        {
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: neglog10(termFdr),
          x1: neglog10(termFdr),
          y0: 0,
          y1: 1,
          line: { dash: 'dash', width: 1, color: '#7a8794' },
        },
      ],
      annotations: [
        {
          x: neglog10(termFdr),
          xref: 'x',
          y: 1,
          yref: 'paper',
          yanchor: 'bottom',
          text: `term FDR ${termFdr}`,
          showarrow: false,
          font: { size: 11, color: '#7a8794' },
        },
        ...(hitAdjPMax === undefined
          ? []
          : [
              {
                x: 1,
                xref: 'paper',
                y: 0,
                yref: 'paper',
                yanchor: 'top',
                xanchor: 'right',
                yshift: -40,
                text: `hits: feature adjusted p ≤ ${hitAdjPMax}`,
                showarrow: false,
                font: { size: 11, color: '#7a8794' },
              },
            ]),
      ],
    },
  };
}
