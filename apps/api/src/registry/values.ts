import {
  createStaticTermIndex,
  parseCell,
  parseQuantity,
  SEED_TERMS,
  type ContractError,
  type ManifestOptions,
  type MetadataFieldDef,
  type Quantity,
} from '@tributary/contracts';
import { HttpError } from '../errors.ts';

/** Ontology lookups use the seed terms until the OLS4-backed cache exists (Phase 6). */
export const MANIFEST_OPTIONS: ManifestOptions = {
  termIndex: createStaticTermIndex(SEED_TERMS),
  plateFormat: '96',
};

const invalid = (errors: ContractError[]) => {
  const first = errors[0]!;
  return new HttpError(400, first.code, first.message, first.field, errors);
};

/** Parses "24 h"-style time points; errors name `time_points.<i>`. */
export function parseTimePoints(values: string[]): Quantity[] {
  const errors: ContractError[] = [];
  const parsed = values.flatMap((value, i) => {
    const result = parseQuantity(value, 'time');
    if (result.ok) return [result.value];
    errors.push({ ...result.error, field: `time_points.${i}` });
    return [];
  });
  if (errors.length) throw invalid(errors);
  return parsed;
}

/** Validates experiment-scope custom values against their field definitions; errors name `custom.<key>`. */
export function parseCustomValues(
  fields: MetadataFieldDef[],
  values: Record<string, string | number | boolean | null>,
): Record<string, unknown> {
  const defs = new Map(fields.filter((f) => f.scope === 'experiment').map((f) => [f.key, f]));
  const errors: ContractError[] = [];
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    if (!defs.has(key))
      errors.push({ code: 'unknown_field', field: `custom.${key}`, message: `No custom field "${key}".` });
  }
  for (const [key, field] of defs) {
    const value = values[key];
    const result = parseCell(
      field,
      value === null || value === undefined ? '' : String(value),
      false,
      MANIFEST_OPTIONS,
    );
    if (result.ok) {
      if (result.value !== null) out[key] = result.value;
    } else errors.push({ code: result.code, field: `custom.${key}`, message: result.message });
  }
  if (errors.length) throw invalid(errors);
  return out;
}

/** Custom fields may not reuse a key within their scope. */
export function checkCustomFields(fields: MetadataFieldDef[], templateKeys: Set<string>): void {
  const seen = new Set<string>();
  fields.forEach((field, i) => {
    const id = `${field.scope}.${field.key}`;
    if (seen.has(id) || (field.scope === 'sample' && templateKeys.has(field.key))) {
      throw new HttpError(
        400,
        'duplicate_field',
        `Custom field "${field.key}" already exists.`,
        `custom_fields.${i}.key`,
      );
    }
    seen.add(id);
  });
}
