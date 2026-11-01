import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';

/** Dose-response viewer (SPEC M8): measured responses and the fitted curve per feature, as small multiples. */
export const doseResponseOptions = z.strictObject({
  /** Regulation classes shown (CurveCurator: up, down, not, unclear). */
  regulation: z
    .array(z.enum(['up', 'down', 'not', 'unclear']))
    .min(1)
    .default(['up', 'down']),
  /** Curves with FDR above this are left out (no filter when empty). */
  fdr_max: z.number().gt(0).max(1).optional(),
  max_curves: z.int().min(1).max(24).default(12),
  sort: z.enum(['fdr_asc', 'pec50_desc']).default('fdr_asc'),
  show_fit: z.boolean().default(true),
  log_dose: z.boolean().default(true),
});
export type DoseResponseOptions = z.infer<typeof doseResponseOptions>;

export const doseResponse: ChartDefinition = {
  type: 'dose_response',
  label: 'Dose-response',
  encodings: {
    label: { required: true, accepts: ['categorical'] },
    /** Prefixed to each small multiple's title (e.g. compound_id when curves come from several compounds). */
    panel: { required: false, accepts: ['categorical'] },
    hover: { required: false, accepts: ['any'], multiple: true },
  },
  options: doseResponseOptions,
  requiresColumns: [
    'feature_id',
    'compound_id',
    'doses_molar',
    'responses',
    'pec50',
    'hill_slope',
    'top',
    'bottom',
    'regulation',
    'fdr',
  ],
  dataRules: { minRows: 1, maxPoints: 50_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scatter'],
};
