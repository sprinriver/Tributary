// QC panel spec for the results page and the report (Phase 41, QCD-04). CVs are meant to show replicate
// variability: when every sample of the version has a condition, the version's sample sheet is joined and the panel
// is coloured by condition, so the chart computes each protein's CV within its condition. Otherwise CVs are pooled
// across all runs (and the caption says so).
import type { ChartSpec } from '@tributary/contracts';
import { LAYOUT } from './ChartView.tsx';

/** The version's conditions (sorted), or null unless every sample has one. */
export function conditionsOf(samples: { factors: Record<string, unknown> }[]): string[] | null {
  const values = samples.map((s) => s.factors['condition']);
  if (values.length === 0 || values.some((v) => typeof v !== 'string' || v.trim() === '')) return null;
  return [...new Set(values as string[])].sort();
}

export function qcPanelSpec(releaseId: string, versionId: string, byCondition: boolean): ChartSpec {
  return {
    type: 'qc_panel',
    data: {
      source: { releaseIds: [releaseId] },
      ...(byCondition
        ? {
            joins: [
              {
                type: 'left' as const,
                target: { kind: 'sample' as const, scope: { experimentVersionIds: [versionId] } },
                alias: 's',
                // Sample keys are unique within a version only.
                on: [
                  { left: 'experiment_version_id', op: '=' as const, right: 'experiment_version_id' },
                  { left: 'sample_key', op: '=' as const, right: 'sample_key' },
                ],
              },
            ],
          }
        : {}),
    },
    encodings: {
      x: 'sample_key',
      rowLabel: 'protein_group',
      values: 'intensity',
      ...(byCondition ? { color: 's.condition' } : {}),
    },
    options: {},
    layout: LAYOUT,
  } as ChartSpec;
}
