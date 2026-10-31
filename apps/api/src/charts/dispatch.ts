import type {
  ChartSpec,
  ChartType,
  DendrogramOptions,
  HeatmapOptions,
  VolcanoOptions,
} from '@tributary/contracts';
import type { Row } from './common.ts';
import type { Compute } from './compute.ts';
import { shapeBox, shapeHistogram, shapeLollipop, shapePie } from './dist-shapes.ts';
import { shapeDendrogram, shapeHeatmap } from './figures.ts';
import { shapeMa, shapePca, shapeQc } from './omics-shapes.ts';
import { shapeVolcano, type Shaped } from './volcano.ts';
import { shapeBar, shapeBubble, shapeLine, shapeScatter } from './xy-shapes.ts';

/** Chart type → shaping (TS display transforms; statistics through `compute`). Options are parsed (defaults applied). */
export async function shapeChart(
  type: ChartType,
  rows: Row[],
  spec: ChartSpec,
  options: Record<string, unknown>,
  compute: Compute,
): Promise<Shaped> {
  switch (type) {
    case 'volcano':
      return shapeVolcano(rows, spec, options as VolcanoOptions);
    case 'heatmap':
      return shapeHeatmap(rows, spec, options as HeatmapOptions, compute.cluster);
    case 'dendrogram':
      return shapeDendrogram(rows, spec, options as DendrogramOptions, compute.cluster);
    case 'line':
      return shapeLine(rows, spec, options);
    case 'bar':
      return shapeBar(rows, spec, options, compute);
    case 'scatter2d':
      return shapeScatter(rows, spec, options);
    case 'scatter3d':
      return shapeScatter(rows, spec, options, true);
    case 'bubble':
      return shapeBubble(rows, spec, options);
    case 'box_violin':
      return shapeBox(rows, spec, options, compute);
    case 'histogram_kde':
      return shapeHistogram(rows, spec, options, compute);
    case 'lollipop':
      return shapeLollipop(rows, spec, options);
    case 'pie_donut':
      return shapePie(rows, spec, options);
    case 'ma':
      return shapeMa(rows, spec, options);
    case 'pca':
      return shapePca(rows, spec, options, compute);
    case 'qc_panel':
      return shapeQc(rows, spec, options, compute);
    default:
      throw new Error(`No shaping for ${type}`);
  }
}
