import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';

// Thermal proteome profiling charts (Phase 46) over a thermal_shift dataset. Nothing is fitted or tested here:
// melting points, ΔTm and adjusted p-values are the source tool's (packages/importers/src/tpp_tr/SOURCE.md).

/** Melting curves: measured fold changes of vehicle and treatment by temperature, as small multiples. */
export const meltingCurveOptions = z.strictObject({
  /** Comparisons with an adjusted p above this, or without one, are left out (no filter when empty). */
  adj_p_max: z.number().gt(0).max(1).optional(),
  /** Only comparisons that passed the tool's curve-quality filter. */
  passed_filter_only: z.boolean().default(false),
  max_curves: z.int().min(1).max(24).default(12),
  sort: z.enum(['adj_p_asc', 'abs_delta_tm_desc']).default('adj_p_asc'),
  /** Draw the fitted curve from the stored parameters (a, b, plateau), where the tool wrote them. */
  show_fit: z.boolean().default(true),
});
export type MeltingCurveOptions = z.infer<typeof meltingCurveOptions>;

export const meltingCurve: ChartDefinition = {
  type: 'melting_curve',
  label: 'Melting curves',
  encodings: {
    label: { required: true, accepts: ['categorical'] },
    /** Added to each small multiple's title (the comparison). */
    panel: { required: false, accepts: ['categorical'] },
    hover: { required: false, accepts: ['any'], multiple: true },
  },
  options: meltingCurveOptions,
  requiresColumns: [
    'feature_id',
    'comparison',
    'temperatures_c',
    'fc_treatment',
    'fc_vehicle',
    'melt_point_treatment',
    'melt_point_vehicle',
    'delta_tm',
    'adj_p_value',
    'passed_filter',
    'a_treatment',
    'b_treatment',
    'plateau_treatment',
    'a_vehicle',
    'b_vehicle',
    'plateau_vehicle',
  ],
  dataRules: { minRows: 1, maxPoints: 50_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scatter'],
};

/** ΔTm against −log10 adjusted p, one panel per comparison. */
export const thermalShiftOptions = z.strictObject({
  adj_p_max: z.number().gt(0).max(1).default(0.05),
  /** A shift smaller than this (°C, either direction) is not classed as stabilised or destabilised. */
  min_abs_delta_tm: z.number().min(0).max(30).default(0),
  label_top: z.int().min(0).max(50).default(10),
});
export type ThermalShiftOptions = z.infer<typeof thermalShiftOptions>;

export const thermalShift: ChartDefinition = {
  type: 'thermal_shift',
  label: 'Thermal shift (ΔTm)',
  encodings: {
    label: { required: true, accepts: ['categorical'] },
    panel: { required: false, accepts: ['categorical'] },
    hover: { required: false, accepts: ['any'], multiple: true },
  },
  options: thermalShiftOptions,
  requiresColumns: ['feature_id', 'comparison', 'delta_tm', 'adj_p_value', 'fulfills_all_requirements'],
  dataRules: { minRows: 1, maxPoints: 500_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scatter'],
};
