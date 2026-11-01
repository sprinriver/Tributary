import { CHART_REGISTRY, type ChartSpec } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { PlotlyFigure } from '../charts/PlotlyFigure.tsx';
import { ErrorMessage } from '../components/ui.tsx';

export const LAYOUT: ChartSpec['layout'] = {
  palette: 'default',
  gridX: true,
  gridY: true,
  sharedX: false,
  sharedY: false,
  sharedLegend: true,
  subplotLegend: false,
};

const noop = () => undefined;

/** A chart on a results page: the spec goes through /v1/charts/render like every other chart (SPEC M7/M8). */
export function ChartView({ spec }: { spec: ChartSpec }) {
  const render = useQuery({
    queryKey: ['chart', spec],
    queryFn: () => api('renderChart', { body: { spec } }),
    staleTime: 60_000,
    retry: false,
  });
  return (
    <div>
      <ErrorMessage error={render.error} />
      {render.isPending && <p role="status">Drawing…</p>}
      {render.data && (
        <>
          <PlotlyFigure
            label={`${CHART_REGISTRY[spec.type]!.label} chart`}
            figure={render.data.figure}
            onSelected={noop}
            onReady={noop}
          />
          {render.data.provenance.transformations.length > 0 && (
            <p className="hint" style={{ margin: 0 }}>
              {render.data.provenance.transformations.join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A plain figure returned by an API (comparison view). */
export function FigureView({
  label,
  figure,
}: {
  label: string;
  figure: { data: Record<string, unknown>[]; layout: Record<string, unknown> };
}) {
  return <PlotlyFigure label={label} figure={figure} onSelected={noop} onReady={noop} />;
}
