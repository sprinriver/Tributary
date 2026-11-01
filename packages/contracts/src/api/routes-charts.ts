import { ChartRenderBodySchema, ChartRenderSchema } from './charts.ts';
import type { ApiRoute } from './route.ts';

/** Charts (SPEC M7). Part of API_ROUTES. */
export const CHART_ROUTES = {
  renderChart: {
    method: 'post',
    path: '/v1/charts/render',
    summary:
      'Render a ChartSpec to Plotly figure JSON (400 field errors before data is read; 422 data rules)',
    body: ChartRenderBodySchema,
    response: ChartRenderSchema,
  },
} as const satisfies Record<string, ApiRoute>;
