// Dot plot of enrichment results (Phase 24, ENR-04): top terms by p-value; x = −log10(adjusted p),
// dot size = hits in the set, colour = fold enrichment. Display transforms only; the statistics come from compute.
import type { EnrichmentTerm } from '@tributary/contracts';

export const FIGURE_TERMS = 20;

export function enrichmentFigure(terms: EnrichmentTerm[], adjPMax: number) {
  const top = terms.slice(0, FIGURE_TERMS).reverse(); // best term at the top of the y axis
  const label = (t: EnrichmentTerm) => (t.name.length > 60 ? `${t.name.slice(0, 57)}…` : t.name);
  const x = top.map((t) => -Math.log10(t.adj_p_value));
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
      xaxis: { title: { text: '−log10(adjusted p)' }, rangemode: 'tozero' },
      yaxis: { automargin: true },
      height: Math.max(300, 26 * top.length + 120),
      showlegend: false,
      shapes: [
        {
          type: 'line',
          xref: 'x',
          yref: 'paper',
          x0: -Math.log10(adjPMax),
          x1: -Math.log10(adjPMax),
          y0: 0,
          y1: 1,
          line: { dash: 'dash', width: 1, color: '#7a8794' },
        },
      ],
    },
  };
}
