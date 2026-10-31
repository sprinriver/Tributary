import { z } from 'zod';
import type { ChartDefinition } from '../charts.ts';
import { matrixRules } from './heatmap.ts';
import { fail, needsEncoding } from './shared.ts';

// SPEC M7 omics presets: MA plot, PCA (scores + variance explained) and a QC panel.

export const maOptions = z.strictObject({
  /** |M| (y, e.g. log2 fold change) at or above this is a hit. */
  fc_threshold: z.number().min(0).default(1),
  /** With an adjusted-p column (z): p at or below this is required for a hit. */
  p_threshold: z.number().gt(0).max(1).default(0.05),
  label_top: z.int().min(0).max(100).default(0),
  webgl: z.boolean().default(true),
});

export const ma: ChartDefinition = {
  type: 'ma',
  label: 'MA plot',
  encodings: {
    x: { required: true, accepts: ['numeric'] },
    y: { required: true, accepts: ['numeric'] },
    z: { required: false, accepts: ['numeric'] },
    label: { required: false, accepts: ['categorical'] },
    hover: { required: false, accepts: ['any'], multiple: true },
  },
  options: maOptions,
  rules: needsEncoding(
    'label_top',
    (o) => (o.label_top as number) > 0,
    'label',
    'Choose a label column to label hits.',
  ),
  dataRules: { minRows: 1, maxPoints: 500_000, nullPolicy: 'drop-and-report' },
  compute: 'ts',
  traces: ['scattergl'],
};

export const pcaOptions = z
  .strictObject({
    /** Unit variance per feature before PCA (correlation PCA). */
    scale: z.boolean().default(false),
    components: z.int().min(2).max(10).default(2),
    pc_x: z.int().min(1).max(10).default(1),
    pc_y: z.int().min(1).max(10).default(2),
  })
  .superRefine((o, ctx) => {
    if (o.pc_x === o.pc_y) fail(ctx, 'pc_y', 'conflict', 'Pick two different components.');
    else if (Math.max(o.pc_x, o.pc_y) > o.components)
      fail(ctx, 'pc_y', 'range', `Only ${o.components} components are computed.`);
  });

export const pca: ChartDefinition = {
  type: 'pca',
  label: 'PCA',
  encodings: {
    rowLabel: { required: true, accepts: ['categorical'] },
    values: { required: true, accepts: ['numeric'], multiple: true },
    x: { required: false, accepts: ['categorical'] },
    color: { required: false, accepts: ['any'] },
    hover: { required: false, accepts: ['any'], multiple: true },
  },
  options: pcaOptions,
  rules: matrixRules,
  dataRules: { minRows: 2, maxPoints: 500_000, nullPolicy: 'drop-and-report' },
  compute: 'python',
  traces: ['scatter'],
};

export const qcOptions = z
  .strictObject({
    /** Intensities are linear (SPEC §6.2): show distributions on log2 (values ≤ 0 left out and counted). */
    log2: z.boolean().default(true),
    show_ids: z.boolean().default(true),
    show_completeness: z.boolean().default(true),
    show_cv: z.boolean().default(true),
    show_intensity: z.boolean().default(true),
  })
  .superRefine((o, ctx) => {
    if (!o.show_ids && !o.show_completeness && !o.show_cv && !o.show_intensity)
      fail(ctx, 'show_ids', 'requires', 'Show at least one panel.');
  });

export const qcPanel: ChartDefinition = {
  type: 'qc_panel',
  label: 'QC panel',
  encodings: {
    x: { required: true, accepts: ['categorical'] },
    rowLabel: { required: true, accepts: ['categorical'] },
    values: { required: true, accepts: ['numeric'] },
    color: { required: false, accepts: ['categorical'] },
  },
  options: qcOptions,
  dataRules: { minRows: 1, maxPoints: 500_000, nullPolicy: 'drop-and-report' },
  compute: 'python',
  traces: ['bar', 'box'],
};
