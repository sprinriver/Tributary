import type { ChartSpec, DoseResponseOptions } from '@tributary/contracts';
import { axisRefs, colourAt, enc, one, toLabel, toNumber, type Row } from './common.ts';
import { dataError } from './errors.ts';
import type { Shaped } from './volcano.ts';

const NEEDED = ['doses_molar', 'responses', 'pec50', 'hill_slope', 'top', 'bottom', 'regulation'];

/**
 * CurveCurator's log-logistic model (importer SOURCE.md: top = Curve Front, the low-dose plateau; bottom = Curve
 * Back): f(d) = bottom + (top − bottom) / (1 + 10^(slope · (log10 d − log10 EC50))), EC50 = 10^−pEC50.
 * Evaluating the fitted curve is display of stored parameters, not a new fit.
 */
const fitted = (d: number, r: Row) => {
  const [top, bottom, slope, pec50] = ['top', 'bottom', 'hill_slope', 'pec50'].map(
    (k) => toNumber(r[k]) as number,
  );
  return bottom! + (top! - bottom!) / (1 + 10 ** (slope! * (Math.log10(d) + pec50!)));
};

/** Dose-response viewer (SPEC M8): small multiples of measured responses with the fitted curve. */
export function shapeDoseResponse(rows: Row[], spec: ChartSpec, o: DoseResponseOptions): Shaped {
  const e = enc(spec);
  const label = one(e, 'label')!;
  const panel = one(e, 'panel');
  if (rows.length && NEEDED.some((c) => !(c in rows[0]!)))
    throw dataError(
      'wrong_kind',
      'data',
      'The dose-response viewer needs a dose_response dataset (doses, responses and fitted parameters).',
    );
  const byClass = rows.filter((r) => o.regulation.includes(String(r.regulation) as never));
  // CurveCurator reports FDR only in FDR mode: a curve without one is not "FDR 1"; it is counted and named.
  const noFdr = byClass.filter((r) => toNumber(r.fdr) === null).length;
  const matching = byClass.filter(
    (r) => o.fdr_max === undefined || (toNumber(r.fdr) !== null && toNumber(r.fdr)! <= o.fdr_max),
  );
  const sorted = [...matching].sort((a, b) =>
    o.sort === 'pec50_desc'
      ? (toNumber(b.pec50) ?? -Infinity) - (toNumber(a.pec50) ?? -Infinity)
      : (toNumber(a.fdr) ?? Infinity) - (toNumber(b.fdr) ?? Infinity),
  );
  const shown = sorted.slice(0, o.max_curves);
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(shown.length))));
  const data: Record<string, unknown>[] = [];
  let hiddenControls = 0;
  const layout: Record<string, unknown> = {
    grid: { rows: Math.max(1, Math.ceil(shown.length / columns)), columns, pattern: 'independent' },
    showlegend: false,
    height: Math.max(320, 260 * Math.ceil(shown.length / columns)),
    annotations: [] as unknown[],
    ...(spec.title ? { title: { text: spec.title } } : {}),
  };
  shown.forEach((r, i) => {
    const refs = axisRefs(i);
    const doses = (r.doses_molar as number[]).map(Number);
    const responses = (r.responses as (number | null)[]).map((v) => (v === null ? null : Number(v)));
    // Control (dose 0) cannot sit on a log axis: shown only on a linear axis.
    const keep = doses.map((d) => !o.log_dose || d > 0);
    hiddenControls += keep.filter((k) => !k).length;
    const colour = colourAt(spec, ['up', 'down', 'not', 'unclear'].indexOf(String(r.regulation)));
    data.push({
      type: 'scatter',
      mode: 'markers',
      x: doses.filter((_, k) => keep[k]),
      y: responses.filter((_, k) => keep[k]),
      marker: { color: colour, size: 7 },
      ...refs,
    });
    const positive = doses.filter((d) => d > 0);
    if (o.show_fit && positive.length && toNumber(r.pec50) !== null) {
      const [lo, hi] = [Math.log10(Math.min(...positive)), Math.log10(Math.max(...positive))];
      const xs = Array.from({ length: 60 }, (_, k) => 10 ** (lo + ((hi - lo) * k) / 59));
      data.push({
        type: 'scatter',
        mode: 'lines',
        x: xs,
        y: xs.map((d) => fitted(d, r)),
        line: { color: colour },
        hoverinfo: 'skip',
        ...refs,
      });
    }
    const title = `${panel ? `${toLabel(r[panel])} · ` : ''}${toLabel(r[label])}`;
    (layout.annotations as unknown[]).push({
      text: title,
      showarrow: false,
      xref: `${refs.xaxis} domain`,
      yref: `${refs.yaxis} domain`,
      x: 0.5,
      y: 1.12,
      font: { size: 11 },
    });
    const s = i === 0 ? '' : String(i + 1);
    layout[`xaxis${s}`] = {
      type: o.log_dose ? 'log' : 'linear',
      title: { text: i === 0 ? 'dose (M)' : '' },
      showgrid: spec.layout.gridX,
    };
    layout[`yaxis${s}`] = { title: { text: i === 0 ? 'response' : '' }, showgrid: spec.layout.gridY };
  });
  if (!shown.length) {
    // Say why the chart is empty instead of drawing empty axes.
    layout.annotations = [
      {
        text:
          o.fdr_max !== undefined && noFdr === byClass.length && noFdr > 0
            ? 'No curves match: this dataset reports no FDR (CurveCurator was not run in FDR mode).'
            : 'No curves match these filters (regulation, FDR).',
        showarrow: false,
        xref: 'paper',
        yref: 'paper',
        x: 0.5,
        y: 0.5,
        font: { size: 14 },
      },
    ];
    layout.xaxis = { visible: false };
    layout.yaxis = { visible: false };
  }
  const notes = [
    `${shown.length} of ${rows.length} curves shown (regulation ${o.regulation.join(', ')}${o.fdr_max !== undefined ? `; FDR ≤ ${o.fdr_max}` : ''}; sorted by ${o.sort === 'fdr_asc' ? 'FDR' : 'pEC50'})`,
    ...(o.show_fit
      ? ['fitted curves drawn from stored CurveCurator parameters (top, bottom, slope, pEC50)']
      : []),
    ...(noFdr
      ? [
          `${noFdr} curve(s) have no FDR${o.fdr_max !== undefined ? ' and are left out by the FDR filter' : ''}`,
        ]
      : []),
    ...(hiddenControls ? [`${hiddenControls} control point(s) (dose 0) not shown on the log dose axis`] : []),
  ];
  return { data, layout, rows: shown.length, dropped: 0, transformations: notes, compute: {} };
}
