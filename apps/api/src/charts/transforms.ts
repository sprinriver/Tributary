// Display transforms allowed in TypeScript (.claude/rules/science.md): pseudolog, z-score. Statistics go to compute.

/** Pseudolog: asinh(v / 2) / ln(base) — log-like for |v| ≫ 1, linear near 0, defined for negatives
 * (scales::pseudo_log_trans with sigma = 1, https://scales.r-lib.org/reference/transform_log.html). */
export const pseudolog = (v: number, base: number) => Math.asinh(v / 2) / Math.log(base);

/** (v − mean) / sample SD (n − 1) over present values; < 2 values or SD 0 → null. */
export function zscore(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return values.map(() => null);
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const sd = Math.sqrt(present.reduce((a, b) => a + (b - mean) ** 2, 0) / (present.length - 1));
  return values.map((v) => (v === null || sd === 0 ? null : (v - mean) / sd));
}

export const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const toLabel = (v: unknown): string =>
  v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v);
