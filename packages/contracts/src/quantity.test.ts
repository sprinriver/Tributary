import { describe, expect, it } from 'vitest';
import { parseQuantity } from './index.ts';

describe('quantity parsing', () => {
  it.each(['1 µM', '1 μM', '1uM', '1 uM', '1000 nM', '0.001 mM', '1e-6 M', '1000000 pM'])(
    'CON-02: "%s" normalises to 1e-6 M',
    (input) => {
      const result = parseQuantity(input, 'concentration');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.canonical).toBeCloseTo(1e-6, 18);
        expect(result.value.canonicalUnit).toBe('M');
      }
    },
  );

  it('CON-02: keeps the value and display unit as entered', () => {
    const result = parseQuantity('1000 nM', 'concentration');
    expect(result).toEqual({
      ok: true,
      value: { value: 1000, unit: 'nM', canonical: 1e-6, canonicalUnit: 'M' },
    });
  });

  it('CON-02: micro written as u, µ (micro sign) or μ (Greek mu) displays as µM', () => {
    for (const input of ['5uM', '5µM', '5μM']) {
      const result = parseQuantity(input, 'concentration');
      expect(result.ok && result.value.unit).toBe('µM');
    }
  });

  it.each([
    ['30 s', 30 / 3600],
    ['90 min', 1.5],
    ['24 h', 24],
    ['2 d', 48],
  ])('CON-02: time "%s" normalises to %f hours', (input, hours) => {
    const result = parseQuantity(input, 'time');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.canonical).toBeCloseTo(hours, 12);
      expect(result.value.canonicalUnit).toBe('h');
    }
  });

  it('CON-02: "5 parsecs" is rejected as an unknown unit', () => {
    const result = parseQuantity('5 parsecs', 'concentration');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_unit');
  });

  it('CON-02: a number without a unit is rejected as missing_unit', () => {
    const result = parseQuantity('10', 'concentration');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('missing_unit');
  });

  it('CON-02: a time unit is rejected for a concentration and vice versa', () => {
    expect(parseQuantity('5 h', 'concentration').ok).toBe(false);
    expect(parseQuantity('5 nM', 'time').ok).toBe(false);
  });

  it.each(['', 'abc nM', '-1 nM', 'NaN nM', 'Infinity h'])('CON-02: "%s" is rejected', (input) => {
    expect(parseQuantity(input, 'concentration').ok).toBe(false);
  });
});
