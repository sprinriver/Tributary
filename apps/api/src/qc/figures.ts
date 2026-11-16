// Figures of the QC overview (Phase 27): display only; values come from overview.ts and apps/compute.
import type { QcColorBy, QcRun } from '@tributary/contracts';

/** Colour-blind-safe categorical palette (Okabe–Ito), cycled. */
const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'];
/** Symbols vary with the colour cycle, so more than 8 groups stay distinguishable. */
const SYMBOLS = ['circle', 'square', 'diamond', 'triangle-up', 'cross'];
const FLAG = '#D55E00';
const runLabel = (r: QcRun) =>
  `${r.experiment_name} · ${r.sample_key}${r.instrument_run ? ` (${r.instrument_run})` : ''}`;
const marker = (i: number, size: number) => ({
  color: PALETTE[i % PALETTE.length],
  symbol: SYMBOLS[Math.floor(i / PALETTE.length) % SYMBOLS.length],
  size,
});

/**
 * IDs per run, experiments oldest first and runs in manifest order (not necessarily acquisition order, so markers
 * only, no connecting lines); one trace per experiment; flagged runs drawn again as crosses.
 */
export function trendFigure(runs: QcRun[]) {
  const experiments = [...new Set(runs.map((r) => r.experiment_id))];
  const traces: Record<string, unknown>[] = experiments.map((id, i) => {
    const mine = runs.filter((r) => r.experiment_id === id);
    return {
      type: 'scatter',
      mode: 'markers',
      name: `${mine[0]!.experiment_name}${mine[0]!.experiment_date ? ` (${mine[0]!.experiment_date})` : ''}`,
      x: mine.map(runLabel),
      y: mine.map((r) => r.ids),
      customdata: mine.map((r) => [r.missing_pct, r.median_log2_intensity]),
      marker: marker(i, 8),
      hovertemplate:
        '%{x}<br>IDs %{y}<br>missing %{customdata[0]:.1f}%<br>median log2 %{customdata[1]:.2f}<extra></extra>',
    };
  });
  const flagged = runs.filter((r) => r.flagged);
  if (flagged.length)
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name: 'flagged (low IDs)',
      x: flagged.map(runLabel),
      y: flagged.map((r) => r.ids),
      marker: { symbol: 'x', size: 14, color: FLAG, line: { width: 2 } },
      hovertemplate: '%{x}<br>flagged: IDs %{y}<extra></extra>',
    });
  return {
    data: traces,
    layout: {
      xaxis: {
        title: { text: 'run (experiments oldest first; runs in manifest order)' },
        type: 'category',
        showticklabels: false,
      },
      yaxis: { title: { text: 'protein groups quantified (IDs)' }, rangemode: 'tozero' },
      height: 360,
      legend: { orientation: 'h', y: -0.15 },
    },
  };
}

const pct = (v: number | undefined) => (v === undefined ? 'n/a' : `${(100 * v).toFixed(1)}%`);

/** PC1 × PC2 of runs, one trace per colour value. */
export function pcaFigure(
  runs: QcRun[],
  scores: number[][],
  explained: number[],
  colours: string[],
  colorBy: QcColorBy,
) {
  const values = [...new Set(colours)];
  return {
    data: values.map((value, i) => {
      const idx = colours.flatMap((c, j) => (c === value ? [j] : []));
      return {
        type: 'scatter',
        mode: 'markers',
        name: value,
        x: idx.map((j) => scores[j]![0]),
        y: idx.map((j) => scores[j]![1] ?? null),
        text: idx.map((j) => runLabel(runs[j]!)),
        marker: marker(i, 10),
        hovertemplate: '%{text}<br>PC1 %{x:.2f}<br>PC2 %{y:.2f}<extra>%{fullData.name}</extra>',
      };
    }),
    layout: {
      xaxis: { title: { text: `PC1 (${pct(explained[0])})` }, zeroline: true },
      yaxis: { title: { text: `PC2 (${pct(explained[1])})` }, zeroline: true },
      height: 420,
      legend: { title: { text: colorBy.replace('_', ' ') } },
    },
  };
}
