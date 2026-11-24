import { describe, expect, it } from 'vitest';
import { collectRuns, colourLabel, normalisationNote } from './runs.ts';

const row = (
  sample: string,
  group: string,
  intensity: number | null,
  extra: Record<string, unknown> = {},
) => ({
  sample_key: sample,
  instrument_run: `${sample}_run`,
  protein_group: group,
  protein_ids: group.split(';'),
  intensity,
  log2_intensity: intensity && intensity > 0 ? Math.log2(intensity) : null,
  is_imputed: false,
  normalisation: 'MaxLFQ',
  ...extra,
});

describe('QC runs from protein_quant rows', () => {
  it('QCD-02: imputed cells are not identifications and are counted', () => {
    const r = collectRuns([
      row('S1', 'P1', 100),
      row('S1', 'P2', 200, { is_imputed: true }),
      row('S1', 'P3', 0),
    ]);
    expect(r.runs).toHaveLength(1);
    expect([...r.runs[0]!.values.keys()]).toEqual(['P1']);
    expect(r.imputedCells).toBe(1);
    expect(r.proteinGroups).toBe(3);
  });

  it('QCD-02: each sample × instrument run is its own run (re-injections are not merged)', () => {
    const r = collectRuns([
      row('S1', 'P1', 100, { instrument_run: 'inj1' }),
      row('S1', 'P2', 100, { instrument_run: 'inj2' }),
    ]);
    expect(r.runs.map((x) => [x.sample_key, x.instrument_run, x.values.size])).toEqual([
      ['S1', 'inj1', 1],
      ['S1', 'inj2', 1],
    ]);
  });

  it('QCD-02: a log2-only release is quantified; a derived log2 is counted', () => {
    const r = collectRuns([
      row('S1', 'P1', null, { log2_intensity: 20 }),
      row('S1', 'P2', 1024, { log2_intensity: null }),
    ]);
    expect(r.runs[0]!.values.get('P1')).toBe(20);
    expect(r.runs[0]!.values.get('P2')).toBe(10);
    expect(r.derivedLog2).toBe(1);
  });

  it('QCD-02: protein groups match by their accessions, whatever their order; unplaceable rows are counted', () => {
    const r = collectRuns([row('S1', 'P2;P1', 100), row('S2', 'P1;P2', 100), row('', 'P3', 1)]);
    expect([...r.runs[0]!.values.keys()]).toEqual([...r.runs[1]!.values.keys()]);
    expect(r.droppedRows).toBe(1);
    expect(r.normalisation).toEqual(['MaxLFQ']);
    expect(collectRuns([row('S1', 'P1', 1, { normalisation: null })]).normalisation).toEqual([
      'not reported',
    ]);
  });

  it('QCD-02: plates and conditions are coloured within their experiment; mixed normalisation is warned', () => {
    const run = (experiment: string) => ({
      experiment_name: experiment,
      program_code: 'QCD',
      experiment_date: null,
      factors: { plate: 'P1' },
    });
    expect(colourLabel(run('A'), 'plate')).not.toBe(colourLabel(run('B'), 'plate'));
    expect(colourLabel(run('A'), 'condition')).toBe('A · not recorded');
    expect(normalisationNote([['MaxLFQ'], ['MaxLFQ']])).toBeNull();
    expect(normalisationNote([['MaxLFQ'], ['not reported']])).toMatch(/normalisation differs/);
  });
});
