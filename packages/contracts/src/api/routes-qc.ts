import { QcOverviewBodySchema, QcOverviewSchema } from './qc.ts';
import type { ApiRoute } from './route.ts';

/** Cross-experiment QC (Phase 27). Part of API_ROUTES. */
export const QC_ROUTES = {
  qcOverview: {
    method: 'post',
    path: '/v1/qc/overview',
    summary:
      'Per-run QC across the latest published experiments, outlier runs and a PCA of runs (batch effects)',
    body: QcOverviewBodySchema,
    response: QcOverviewSchema,
  },
} as const satisfies Record<string, ApiRoute>;
