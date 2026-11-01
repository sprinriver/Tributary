import { describe, expect, it } from 'vitest';
import { normaliseWell } from './index.ts';

describe('plate wells', () => {
  it('CON-01: accepts wells inside the plate format and pads the column', () => {
    expect(normaliseWell('A1', '96')).toBe('A01');
    expect(normaliseWell('H12', '96')).toBe('H12');
    expect(normaliseWell('p24', '384')).toBe('P24');
  });

  it('CON-01: rejects wells outside the plate format', () => {
    expect(normaliseWell('I01', '96')).toBeUndefined();
    expect(normaliseWell('A13', '96')).toBeUndefined();
    expect(normaliseWell('Q01', '384')).toBeUndefined();
    expect(normaliseWell('A00', '384')).toBeUndefined();
    expect(normaliseWell('Z99', '96')).toBeUndefined();
    expect(normaliseWell('A', '96')).toBeUndefined();
  });
});
