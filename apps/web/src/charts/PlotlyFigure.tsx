import { useEffect, useRef, useState } from 'react';

type PlotlyApi = (typeof import('./plotly-bundle.ts'))['default'];
export interface SelectedPoint {
  customdata: unknown[] | undefined;
  x: unknown;
  y: unknown;
}
type PlotElement = HTMLDivElement & {
  on?: (event: string, handler: (e: { points?: SelectedPoint[] } | undefined) => void) => void;
  removeAllListeners?: (event: string) => void;
};

let plotly: Promise<PlotlyApi> | undefined;
const loadPlotly = () => (plotly ??= import('./plotly-bundle.ts').then((m) => m.default));

/** A rendered figure (the element Plotly drew into) as a PNG data URL, e.g. for slides. */
export async function figureToPng(el: HTMLElement, width = 1200, height = 900): Promise<string> {
  const Plotly = await loadPlotly();
  return Plotly.toImage(el, { format: 'png', width, height });
}

/** A Plotly figure (lazy partial bundle), with PNG/SVG download and lasso/box selection. */
export function PlotlyFigure({
  label,
  figure,
  onSelected,
  onReady,
}: {
  label: string;
  figure: { data: Record<string, unknown>[]; layout: Record<string, unknown> };
  onSelected: (points: SelectedPoint[]) => void;
  onReady: (download: (format: 'png' | 'svg') => void) => void;
}) {
  const ref = useRef<PlotElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    void loadPlotly()
      .then(async (Plotly) => {
        if (cancelled) return;
        await Plotly.react(
          el,
          figure.data,
          { autosize: true, height: 560, margin: { t: 40 }, ...figure.layout },
          {
            displaylogo: false,
            responsive: true,
            toImageButtonOptions: { filename: label.toLowerCase().replaceAll(' ', '-') },
          },
        );
        el.removeAllListeners?.('plotly_selected');
        el.on?.('plotly_selected', (e) => onSelected(e?.points ?? []));
        onReady(
          (format) =>
            void Plotly.downloadImage(el, {
              format,
              filename: `tributary-${label.toLowerCase().replaceAll(' ', '-')}`,
            }),
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'The chart could not be drawn.'));
    return () => {
      cancelled = true;
    };
    // onSelected/onReady are stable callbacks from the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figure, label]);
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
    };
  }, []);
  return (
    <div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <div ref={ref} role="figure" aria-label={label} style={{ width: '100%' }} />
    </div>
  );
}
