import { z } from 'zod';
import { dendrogram } from './charts/dendrogram.ts';
import { boxViolin, histogramKde, lollipop, pieDonut } from './charts/distribution.ts';
import { heatmap } from './charts/heatmap.ts';
import { ma, pca, qcPanel } from './charts/omics.ts';
import { doseResponse } from './charts/results.ts';
import { volcano } from './charts/volcano.ts';
import { bar, bubble, line, scatter2d, scatter3d } from './charts/xy.ts';
import { UuidV7Schema } from './common.ts';
import type { ContractError } from './errors.ts';
import { QuerySpecSchema } from './query.ts';

/** The 12 v1 chart types (REFERENCE_V1 §7) plus MA plot, PCA, dose-response and QC panel (SPEC §7.2). */
export const CHART_TYPES = [
  'line',
  'bar',
  'scatter2d',
  'scatter3d',
  'box_violin',
  'histogram_kde',
  'lollipop',
  'volcano',
  'bubble',
  'heatmap',
  'dendrogram',
  'pie_donut',
  'ma',
  'pca',
  'dose_response',
  'qc_panel',
] as const;
export const ChartTypeSchema = z.enum(CHART_TYPES);
export type ChartType = z.infer<typeof ChartTypeSchema>;

export const ENCODING_SLOTS = [
  'x',
  'y',
  'z',
  'color',
  'shape',
  'opacity',
  'size',
  'hover',
  'panel',
  'label',
  'rowLabel',
  'values',
  'categories',
] as const;
export type EncodingSlot = (typeof ENCODING_SLOTS)[number];

export interface EncodingDef {
  required: boolean;
  accepts: ('numeric' | 'categorical' | 'temporal' | 'any')[];
  multiple?: boolean;
}

/** One schema per chart type: the UI form, server validation and tests all come from it (REFERENCE_V1 §8). */
export interface ChartDefinition {
  type: ChartType;
  label: string;
  encodings: Partial<Record<EncodingSlot, EncodingDef>>;
  /** Types, ranges, defaults and cross-field `requires` rules. */
  options: z.ZodType;
  /** Columns the chart always reads besides its encodings (e.g. fitted curve parameters of a dose_response). */
  requiresColumns?: string[];
  /** Columns the chart also reads when the dataset has them (e.g. is_imputed for the QC panel). */
  readIfPresent?: string[];
  /** Rules that need the encodings too (e.g. labelling hits needs a label column). */
  rules?: (spec: ChartSpec, options: unknown) => ContractError[];
  dataRules: {
    minRows?: number;
    minRowsPerGroup?: number;
    maxFacets?: number;
    maxPoints?: number;
    nullPolicy: 'drop-and-report' | 'block';
  };
  compute: 'none' | 'ts' | 'python';
  traces: string[];
}

/** Filled in Phases 14–15 via the add-chart-type skill. */
export const CHART_REGISTRY: Partial<Record<ChartType, ChartDefinition>> = {
  line,
  bar,
  scatter2d,
  scatter3d,
  box_violin: boxViolin,
  histogram_kde: histogramKde,
  lollipop,
  volcano,
  bubble,
  heatmap,
  dendrogram,
  pie_donut: pieDonut,
  ma,
  pca,
  qc_panel: qcPanel,
  dose_response: doseResponse,
};

/** Option values with every default applied (what the form starts from). */
export const chartDefaults = (type: ChartType): Record<string, unknown> =>
  (CHART_REGISTRY[type]?.options.parse({}) ?? {}) as Record<string, unknown>;

/** Colour palettes for `layout.palette` (colours live with the renderer). `colorblind` = Okabe–Ito. */
export const CHART_PALETTES = ['default', 'colorblind', 'viridis', 'greys'] as const;

const AxisSchema = z.strictObject({ title: z.string().optional() });

export const ChartSpecSchema = z
  .strictObject({
    type: ChartTypeSchema,
    title: z.string().optional(),
    data: z.union([QuerySpecSchema, z.strictObject({ savedViewId: UuidV7Schema })]),
    encodings: z.partialRecord(z.enum(ENCODING_SLOTS), z.union([z.string(), z.array(z.string()).min(1)])),
    /** Validated per type against CHART_REGISTRY[type].options. */
    options: z.record(z.string(), z.unknown()),
    axes: z
      .strictObject({ x: AxisSchema.optional(), y: AxisSchema.optional(), z: AxisSchema.optional() })
      .optional(),
    layout: z.strictObject({
      palette: z.string().min(1),
      gridX: z.boolean(),
      gridY: z.boolean(),
      sharedX: z.boolean(),
      sharedY: z.boolean(),
      sharedLegend: z.boolean(),
      subplotLegend: z.boolean(),
    }),
  })
  .meta({ id: 'ChartSpec' });
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
