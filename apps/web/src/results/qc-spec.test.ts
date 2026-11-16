import { describe, expect, it } from 'vitest';
import { conditionsOf, qcPanelSpec } from './qc-spec.ts';
import { QC_CAPTION, QC_CAPTION_BY_CONDITION, reportSlides } from './report-slides.ts';

const sample = (key: string, condition?: string) => ({
  sample_key: key,
  factors: condition ? { condition } : {},
});
const RELEASE = '01a1c15b-e943-73ed-8dfe-58d498e2430c';
const VERSION = '01a1c15b-e943-73ed-8dfe-58d498e2430d';

describe('QC panel per condition', () => {
  it('QCD-04: conditions are used only when every sample has one', () => {
    expect(conditionsOf([sample('S1', 'DMSO'), sample('S2', 'CPD@1 µM'), sample('S3', 'DMSO')])).toEqual([
      'CPD@1 µM',
      'DMSO',
    ]);
    expect(conditionsOf([sample('S1', 'DMSO'), sample('S2')])).toBeNull(); // one without: pooled
    expect(conditionsOf([])).toBeNull();
  });

  it('QCD-04: with conditions, the chart joins the version’s samples and computes CVs within each condition', () => {
    const spec = qcPanelSpec(RELEASE, VERSION, true);
    expect(spec.data).toEqual({
      source: { releaseIds: [RELEASE] },
      joins: [
        {
          type: 'left',
          target: { kind: 'sample', scope: { experimentVersionIds: [VERSION] } },
          alias: 's',
          on: [
            { left: 'experiment_version_id', op: '=', right: 'experiment_version_id' },
            { left: 'sample_key', op: '=', right: 'sample_key' },
          ],
        },
      ],
    });
    expect(spec.encodings).toEqual({
      x: 'sample_key',
      rowLabel: 'protein_group',
      values: 'intensity',
      color: 's.condition',
    });
    const pooled = qcPanelSpec(RELEASE, VERSION, false);
    expect(pooled.data).toEqual({ source: { releaseIds: [RELEASE] } });
    expect(pooled.encodings).not.toHaveProperty('color');
  });

  it('QCD-04: the report says which CV it shows, on the page caption and the slide', () => {
    expect(QC_CAPTION_BY_CONDITION).toContain('CV within each condition');
    expect(QC_CAPTION).toContain('conditions pooled');
    const slides = reportSlides({
      experiment: 'E',
      program: 'P',
      version: 1,
      assay: 'a',
      samples: 2,
      generatedAt: '2026-11-09',
      methods: 'm',
      thresholds: { fc: 1, p: 0.05 },
      contrasts: [],
      qc: { dataset: 'D', tool: null, image: null, byCondition: true },
    });
    expect(slides.find((s) => s.title === 'QC')!.lines).toEqual(['D', QC_CAPTION_BY_CONDITION]);
  });
});
