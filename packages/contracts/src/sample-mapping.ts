import type { ManifestRow } from './manifest.ts';
import type { Quantity } from './quantity.ts';

const CHARACTERISTICS = ['organism', 'cell_line', 'tissue', 'cell_type', 'disease'];
const FACTORS = [
  'compound_id',
  'vehicle',
  'condition',
  'replicate_group',
  'biological_replicate',
  'technical_replicate',
];
const TECHNICAL = ['plate', 'well', 'fraction', 'label_channel', 'instrument_run', 'raw_file'];
const QUANTITIES = ['dose', 'time'];
const TOP_LEVEL = ['sample_key', 'source_name'];
const KNOWN = new Set([...CHARACTERISTICS, ...FACTORS, ...TECHNICAL, ...QUANTITIES, ...TOP_LEVEL]);

export interface SampleColumns {
  sample_key: string;
  source_name: string | null;
  characteristics: Record<string, unknown>;
  factors: Record<string, unknown>;
  technical: Record<string, unknown>;
  custom: Record<string, unknown>;
}

const isQuantity = (value: unknown): value is Quantity =>
  typeof value === 'object' && value !== null && 'canonical' in value && 'unit' in value;

/**
 * Splits a validated manifest row into the Sample jsonb groups (SPEC §4). Doses become `dose_molar` (+ display),
 * times `time_hours` (+ display); reserved tokens are kept as written; empty cells are left out; columns that are
 * not template columns go to `custom`.
 */
export function manifestRowToSample(row: ManifestRow): SampleColumns {
  const present = (key: string) => row[key] !== null && row[key] !== undefined;
  const pick = (keys: string[]) => Object.fromEntries(keys.filter(present).map((k) => [k, row[k]]));
  const factors: Record<string, unknown> = pick(FACTORS);
  const dose = row.dose;
  if (isQuantity(dose))
    Object.assign(factors, { dose_molar: dose.canonical, dose_display: `${dose.value} ${dose.unit}` });
  else if (typeof dose === 'string') factors.dose_display = dose;
  const time = row.time;
  if (isQuantity(time))
    Object.assign(factors, { time_hours: time.canonical, time_display: `${time.value} ${time.unit}` });
  else if (typeof time === 'string') factors.time_display = time;
  return {
    sample_key: String(row.sample_key),
    source_name: typeof row.source_name === 'string' ? row.source_name : null,
    characteristics: pick(CHARACTERISTICS),
    factors,
    technical: pick(TECHNICAL),
    custom: Object.fromEntries(
      Object.keys(row)
        .filter((k) => !KNOWN.has(k) && present(k))
        .map((k) => [k, row[k]]),
    ),
  };
}
