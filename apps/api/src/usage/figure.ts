// Weekly usage chart (Phase 36): active people as a line, activity as stacked bars. Display only.
import type { UsageWeek } from '@tributary/contracts';

const SERIES: { key: keyof UsageWeek; name: string; color: string }[] = [
  { key: 'experiments_created', name: 'Experiments created', color: '#0072B2' },
  { key: 'versions_published', name: 'Versions published', color: '#56B4E9' },
  { key: 'imports', name: 'Imports', color: '#009E73' },
  { key: 'releases_published', name: 'Releases published', color: '#E69F00' },
  { key: 'pipeline_runs', name: 'Pipeline runs', color: '#CC79A7' },
  { key: 'exports', name: 'Exports', color: '#D55E00' },
  { key: 'assistant', name: 'Assistant tool calls', color: '#999999' },
  { key: 'triage', name: 'Triage actions', color: '#F0E442' },
];

export function usageFigure(weekly: UsageWeek[]) {
  const x = weekly.map((w) => w.week_start);
  // People are whole numbers: whole-number ticks on their axis.
  const peopleStep = Math.max(1, Math.ceil(Math.max(0, ...weekly.map((w) => w.active_users)) / 5));
  return {
    data: [
      ...SERIES.map((s) => ({
        type: 'bar',
        name: s.name,
        x,
        y: weekly.map((w) => w[s.key]),
        marker: { color: s.color },
      })),
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Active people',
        x,
        y: weekly.map((w) => w.active_users),
        yaxis: 'y2',
        line: { color: '#102A43', width: 2 },
      },
    ],
    layout: {
      barmode: 'stack',
      height: 380,
      xaxis: { title: { text: 'week starting (Monday, UTC)' }, type: 'category' },
      yaxis: { title: { text: 'actions' }, rangemode: 'tozero' },
      yaxis2: {
        title: { text: 'active people' },
        overlaying: 'y',
        side: 'right',
        rangemode: 'tozero',
        showgrid: false,
        // People are whole numbers: linear whole-number ticks, not synced to the actions axis.
        tickmode: 'linear',
        tick0: 0,
        dtick: peopleStep,
        tickformat: 'd',
      },
      legend: { orientation: 'h', y: -0.25 },
    },
  };
}
