import { describe, expect, it } from 'vitest';
import { parseTemperatures, tppOptions } from './tpp-options.ts';

describe('TPP-TR import options', () => {
  it('TPP-01: the import dialog reads a pasted label → temperature table and refuses what is not °C', () => {
    expect(parseTemperatures('126\t37\n127L, 41\n127H = 44.5\n')).toEqual({
      map: { '126': 37, '127L': 41, '127H': 44.5 },
    });
    expect(parseTemperatures('')).toHaveProperty('error');
    expect(parseTemperatures('126')).toHaveProperty('error');
    expect(parseTemperatures('126 warm')).toHaveProperty('error');
    expect(parseTemperatures('126 310.15')).toEqual({
      error: '“126 310.15”: temperatures are in °C (0–100).',
    });
    expect(parseTemperatures('126 37\n126 41')).toEqual({ error: 'Label 126 appears twice.' });
  });

  it('TPP-01: the import dialog sends options only when compound, feature type and temperatures are given', () => {
    const draft = { compound_id: ' CPD-000005 ', feature_type: 'gene' as const, temperatures: '126 37' };
    expect(tppOptions(draft)).toEqual({
      compound_id: 'CPD-000005',
      feature_type: 'gene',
      temperatures: { '126': 37 },
    });
    expect(tppOptions({ ...draft, feature_type: '' })).toBeNull(); // never guessed
    expect(tppOptions({ ...draft, compound_id: '' })).toBeNull();
    expect(tppOptions({ ...draft, temperatures: '126' })).toBeNull();
  });
});
