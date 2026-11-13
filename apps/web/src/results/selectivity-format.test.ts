import { describe, expect, it } from 'vitest';
import { ec50Label } from './SelectivitySection.tsx';

describe('selectivity display', () => {
  it('SEL-03: EC50 labels round before choosing the unit', () => {
    expect(ec50Label(6)).toBe('1 µM');
    expect(ec50Label(7)).toBe('100 nM');
    expect(ec50Label(5.5)).toBe('3.16 µM');
    expect(ec50Label(6.0000001)).toBe('1 µM'); // not "1000 nM"
    expect(ec50Label(8.9999999)).toBe('1 nM');
  });
});
