import { describe, expect, it } from 'vitest';
import { methodLabel, orderRows, rowStatus } from './table.ts';

const row = (dataset: number, compound: string, sRegulated: number, tested: number) => ({
  dataset,
  compound_id: compound,
  s_regulated: sRegulated,
  s_score: tested ? sRegulated / tested : null,
});

describe('selectivity table', () => {
  it('SEL-04: a compound with nothing regulated at the threshold is inactive, not selective', () => {
    expect(rowStatus(row(0, 'A', 0, 100))).toBe('inactive');
    expect(rowStatus(row(0, 'A', 1, 100))).toBe('ranked');
    expect(rowStatus(row(0, 'A', 0, 0))).toBe('no_score');
  });

  it('SEL-04: rows stay grouped by dataset; within one, lowest S first, then inactive, then without a score', () => {
    const rows = [
      row(1, 'deep', 2, 4000), // S = 0.0005, another dataset: never ranked against dataset 0
      row(0, 'inactive', 0, 100),
      row(0, 'broad', 30, 100),
      row(0, 'selective', 1, 100),
      row(0, 'untested', 0, 0),
    ];
    expect(orderRows(rows).map((r) => r.compound_id)).toEqual([
      'selective',
      'broad',
      'inactive',
      'untested',
      'deep',
    ]);
  });

  it('SEL-04: several fitting tools for one compound are named, not reduced to the first', () => {
    expect(methodLabel(new Set(['CurveCurator']))).toBe('CurveCurator');
    expect(methodLabel(new Set(['CurveCurator', '4PL']))).toBe('mixed: 4PL, CurveCurator');
    expect(methodLabel(new Set())).toBeNull();
  });
});
