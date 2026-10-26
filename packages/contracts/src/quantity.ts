import { z } from 'zod';
import type { ContractError } from './errors.ts';

export type QuantityKind = 'concentration' | 'time';

/**
 * A parsed quantity: what the user typed (value + display unit) and the canonical value used for storage and joins.
 * Canonical units follow the manifest contract (SPEC §6.1): concentration in molar (`dose_molar`), time in hours
 * (`time_hours`).
 */
export const QuantitySchema = z
  .object({
    value: z.number().nonnegative(),
    unit: z.string().min(1),
    canonical: z.number().nonnegative(),
    canonicalUnit: z.enum(['M', 'h']),
  })
  .meta({ id: 'Quantity' });
export type Quantity = z.infer<typeof QuantitySchema>;

export type QuantityResult = { ok: true; value: Quantity } | { ok: false; error: ContractError };

interface UnitDef {
  kind: QuantityKind;
  display: string;
  toCanonical: (value: number) => number;
}

// Divide rather than multiply by powers of ten so that e.g. 1000 nM gives exactly 1e-6 M.
const concentration = (display: string, divisor: number): UnitDef => ({
  kind: 'concentration',
  display,
  toCanonical: (v) => v / divisor,
});
const time = (display: string, toHours: (v: number) => number): UnitDef => ({
  kind: 'time',
  display,
  toCanonical: toHours,
});

const M = concentration('M', 1);
const mM = concentration('mM', 1e3);
const uM = concentration('µM', 1e6);
const nM = concentration('nM', 1e9);
const pM = concentration('pM', 1e12);
const seconds = time('s', (v) => v / 3600);
const minutes = time('min', (v) => v / 60);
const hours = time('h', (v) => v);
const days = time('d', (v) => v * 24);

/** Accepted spellings. Micro may be typed as u, µ (U+00B5 micro sign) or μ (U+03BC Greek mu). */
const UNITS: Record<string, UnitDef> = {
  M,
  mM,
  uM,
  µM: uM,
  μM: uM,
  nM,
  pM,
  s: seconds,
  sec: seconds,
  min: minutes,
  h: hours,
  hr: hours,
  hrs: hours,
  hour: hours,
  hours,
  d: days,
  day: days,
  days,
};

const QUANTITY = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(\S.*)?$/;
const CANONICAL_UNIT: Record<QuantityKind, Quantity['canonicalUnit']> = { concentration: 'M', time: 'h' };
const EXAMPLES: Record<QuantityKind, string> = { concentration: '1 µM', time: '24 h' };

/** Parses "1 µM", "1uM", "1000 nM", "90 min" … into a value, a display unit and a canonical value. */
export function parseQuantity(input: string, kind: QuantityKind): QuantityResult {
  const fail = (code: string, message: string): QuantityResult => ({ ok: false, error: { code, message } });
  const match = QUANTITY.exec(input.trim());
  if (!match?.[1]) return fail('invalid_quantity', `Expected a number and a unit, e.g. "${EXAMPLES[kind]}".`);

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0)
    return fail('invalid_quantity', 'The amount must be a number ≥ 0.');

  const unitText = match[2]?.trim();
  if (!unitText) return fail('missing_unit', `Add a unit, e.g. "${EXAMPLES[kind]}".`);

  const unit = UNITS[unitText];
  if (!unit) return fail('unknown_unit', `Unknown unit "${unitText}".`);
  if (unit.kind !== kind) return fail('wrong_unit_kind', `"${unitText}" is not a ${kind} unit.`);

  return {
    ok: true,
    value: {
      value,
      unit: unit.display,
      canonical: unit.toCanonical(value),
      canonicalUnit: CANONICAL_UNIT[kind],
    },
  };
}
