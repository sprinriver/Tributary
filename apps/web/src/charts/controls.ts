import { CHART_REGISTRY, type ChartType } from '@tributary/contracts';
import { z } from 'zod';

/** One form control derived from a registry option schema (the registry is the only source of truth). */
export type Control =
  | { kind: 'number'; name: string; min?: number; max?: number; integer: boolean; optional: boolean }
  | { kind: 'boolean'; name: string }
  | { kind: 'enum'; name: string; values: string[] };

export const OPTION_LABELS: Record<string, string> = {
  fc_threshold: 'Fold-change threshold',
  p_threshold: 'p threshold',
  y_transform: 'Y transform',
  label_top: 'Label top hits',
  pseudolog_x: 'Pseudolog X',
  pseudolog_y: 'Pseudolog Y',
  pseudolog_base: 'Pseudolog base',
  standardize_x: 'Standardise X (z-score)',
  webgl: 'WebGL (large tables)',
  scale: 'Standardise',
  standardize: 'Standardise',
  min: 'Colour minimum',
  max: 'Colour maximum',
  centered: 'Centred colour scale',
  cluster_rows: 'Cluster rows',
  cluster_columns: 'Cluster columns',
  dendrograms: 'Dendrograms',
  method: 'Clustering method',
  metric: 'Distance metric',
  leaf_ordering: 'Leaf ordering',
  axis: 'Cluster',
  orientation: 'Root position',
  interpolation: 'Links',
  color_scheme: 'Colours',
  color_threshold: 'Colour threshold',
  bootstrap_n: 'Bootstrap iterations',
  seed: 'Random seed',
  attach_heatmap: 'Attach heatmap',
};

export const SLOT_LABELS: Record<string, string> = {
  x: 'X',
  y: 'Y',
  label: 'Label',
  color: 'Colour',
  opacity: 'Opacity',
  hover: 'Hover',
  values: 'Values',
  rowLabel: 'Row label',
};
/** Matrix charts use x for the column category of long data. */
export const slotLabel = (type: ChartType, slot: string) =>
  (type === 'heatmap' || type === 'dendrogram') && slot === 'x'
    ? 'Column category'
    : (SLOT_LABELS[slot] ?? slot);

function unwrap(schema: z.ZodType): { base: z.ZodType; optional: boolean } {
  let s = schema;
  let optional = false;
  for (;;) {
    if (s instanceof z.ZodDefault) s = s.unwrap() as z.ZodType;
    else if (s instanceof z.ZodOptional) {
      optional = true;
      s = s.unwrap() as z.ZodType;
    } else return { base: s, optional };
  }
}

export function controlsOf(type: ChartType): Control[] {
  const options = CHART_REGISTRY[type]?.options;
  if (!(options instanceof z.ZodObject)) return [];
  return Object.entries(options.shape as Record<string, z.ZodType>).flatMap(([name, schema]): Control[] => {
    const { base, optional } = unwrap(schema);
    if (base instanceof z.ZodNumber) {
      return [
        {
          kind: 'number',
          name,
          integer: base.format === 'safeint' || base.isInt,
          optional,
          ...(Number.isFinite(base.minValue) ? { min: base.minValue! } : {}),
          ...(Number.isFinite(base.maxValue) ? { max: base.maxValue! } : {}),
        },
      ];
    }
    if (base instanceof z.ZodBoolean) return [{ kind: 'boolean', name }];
    if (base instanceof z.ZodEnum) return [{ kind: 'enum', name, values: base.options as string[] }];
    return [];
  });
}
