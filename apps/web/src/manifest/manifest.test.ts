import { SEED_PROTEOMICS_TEMPLATE } from '@tributary/contracts';
import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, mergeBySampleKey } from './mapping.ts';
import { parseTable } from './parse-core.ts';
import { quantityDisplay, validateRows } from './validation.ts';

describe('manifest editor helpers', () => {
  it('MAN-01: detects the delimiter and parses header rows', () => {
    expect(parseTable('sample_key,well\nS1,A01\n')).toMatchObject({
      delimiter: ',',
      fields: ['sample_key', 'well'],
      rows: [{ sample_key: 'S1', well: 'A01' }],
    });
    expect(parseTable('sample_key\twell\nS1\tA01\n').delimiter).toBe('\t');
  });

  it('MAN-03: guesses exact header matches and maps rows', () => {
    const mapping = guessMapping(['Sample Key', 'Species', 'Well'], ['sample_key', 'organism', 'well']);
    expect(mapping).toEqual({ 'Sample Key': 'sample_key', Species: '', Well: 'well' });
    expect(
      applyMapping([{ 'Sample Key': 'S1', Species: 'x', Well: 'A01' }], { ...mapping, Species: 'organism' }),
    ).toEqual([{ sample_key: 'S1', organism: 'x', well: 'A01' }]);
  });

  it('MAN-01: duplicate keys inside an upload are kept as separate rows (so they are flagged)', () => {
    const make = (cells: Record<string, string>) => ({ cells });
    expect(
      mergeBySampleKey(
        [],
        [
          { sample_key: 'S1', well: 'A01' },
          { sample_key: 'S1', well: 'A02' },
        ],
        make,
      ),
    ).toHaveLength(2);
  });

  it('MAN-03: merges incoming rows by sample key', () => {
    const make = (cells: Record<string, string>) => ({ id: cells.sample_key ?? '', cells });
    const merged = mergeBySampleKey(
      [make({ sample_key: 'S1', well: 'A01' })],
      [{ sample_key: 'S1', well: 'B01' }, { sample_key: 'S2' }],
      make,
    );
    expect(merged.map((r) => r.cells)).toEqual([{ sample_key: 'S1', well: 'B01' }, { sample_key: 'S2' }]);
  });

  it('MAN-04: validation errors land on their row and column', () => {
    const rows = [
      { sample_key: 'S1', source_name: 'a', organism: 'Homo sapiens', well: 'Z99' },
      { sample_key: 'S1', source_name: '', organism: 'Homo sapien' },
    ];
    const { errors, count } = validateRows(SEED_PROTEOMICS_TEMPLATE, [], rows);
    expect(count).toBe(4);
    expect(Object.keys(errors.get(0) ?? {})).toEqual(['well']);
    expect(Object.keys(errors.get(1) ?? {}).sort()).toEqual(['organism', 'sample_key', 'source_name']);
  });

  it('MAN-04: quantity cells show the canonical value', () => {
    expect(quantityDisplay('1000 nM', 'concentration')).toBe('1000 nM (1e-6 M)');
    expect(quantityDisplay('90 min', 'time')).toBe('90 min (1.5 h)');
    expect(quantityDisplay('10', 'concentration')).toBe('10');
  });
});
