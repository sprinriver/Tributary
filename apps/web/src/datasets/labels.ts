import type { StatusTone } from '@tributary/ui';

export const RELEASE_TONE: Record<string, StatusTone> = {
  staged: 'pending',
  published: 'ok',
  rejected: 'error',
};
export const releaseLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

/** Column statistic for display: integers as-is, other numbers to 6 significant digits. */
export function statValue(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  return Number.isInteger(value) ? String(value) : value.toPrecision(6);
}
