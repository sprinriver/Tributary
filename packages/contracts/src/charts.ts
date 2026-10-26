import { z } from 'zod';
import { UuidV7Schema } from './common.ts';
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
export const CHART_REGISTRY: Partial<Record<ChartType, ChartDefinition>> = {};

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
