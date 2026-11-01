import { z } from 'zod';
import type { OntologyTerm } from './common.ts';
import { issuesToErrors, type ContractError } from './errors.ts';
import type { TermIndex } from './ontology.ts';
import { normaliseWell, type PlateFormat } from './plate.ts';
import { parseQuantity, type Quantity } from './quantity.ts';
import type { MetadataFieldDef, MetadataTemplateDefinition } from './template.ts';

/** SDRF convention: deliberately absent, distinct from an empty (not yet filled) cell. SPEC §6.1. */
export const RESERVED_TOKENS = ['not available', 'not applicable'] as const;
export type ReservedToken = (typeof RESERVED_TOKENS)[number];

export type CellValue = string | number | boolean | OntologyTerm | Quantity | ReservedToken | null;
export type ManifestRow = Record<string, CellValue>;

export interface ManifestOptions {
  termIndex: TermIndex;
  plateFormat: PlateFormat;
}

export type CellResult = { ok: true; value: CellValue } | { ok: false; code: string; message: string };

const ok = (value: CellValue): CellResult => ({ ok: true, value });
const bad = (code: string, message: string): CellResult => ({ ok: false, code, message });

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const BOOLEAN: Record<string, boolean> = {
  true: true,
  false: false,
  yes: true,
  no: false,
  '1': true,
  '0': false,
};

function isCalendarDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

/** Parses one cell for a field: the same rules for manifest cells and experiment-level custom values. */
export function parseCell(
  field: MetadataFieldDef,
  raw: string,
  isKey: boolean,
  options: ManifestOptions,
): CellResult {
  const text = raw.trim();
  const token = RESERVED_TOKENS.find((t) => t === text.toLowerCase());
  if (text === '' || (isKey && token)) {
    return field.required || isKey ? bad('required', `${field.label} is required.`) : ok(null);
  }
  if (token) return ok(token);

  switch (field.type) {
    case 'text':
      if (field.validator === 'plate_well') {
        const well = normaliseWell(text, options.plateFormat);
        return well
          ? ok(well)
          : bad('invalid_well', `"${text}" is not a well on a ${options.plateFormat}-well plate.`);
      }
      return ok(text);
    case 'number':
      return NUMBER.test(text) ? ok(Number(text)) : bad('invalid_number', `"${text}" is not a number.`);
    case 'integer':
      return /^[+-]?\d+$/.test(text)
        ? ok(Number(text))
        : bad('invalid_integer', `"${text}" is not a whole number.`);
    case 'boolean': {
      const value = BOOLEAN[text.toLowerCase()];
      return value === undefined
        ? bad('invalid_boolean', `"${text}" is not yes/no or true/false.`)
        : ok(value);
    }
    case 'date':
      return isCalendarDate(text) ? ok(text) : bad('invalid_date', `"${text}" is not a date (YYYY-MM-DD).`);
    case 'enum':
      return field.enumValues?.includes(text)
        ? ok(text)
        : bad('invalid_enum', `"${text}" is not one of: ${field.enumValues?.join(', ')}.`);
    case 'ontology_term': {
      const term = options.termIndex.resolve(field.ontology ?? '', text);
      return term ? ok(term) : bad('unknown_term', `"${text}" is not a known ${field.ontology} term.`);
    }
    case 'quantity': {
      const result = parseQuantity(text, field.quantityKind ?? 'concentration');
      return result.ok ? ok(result.value) : bad(result.error.code, result.error.message);
    }
  }
}

/**
 * Builds the zod schema for a sample manifest: `{ rows }` of raw string cells (as parsed from CSV/TSV) in, typed
 * rows out. The same schema runs in the browser and on save (SPEC M2). Errors carry `params.code`.
 */
export function buildManifestSchema(
  template: MetadataTemplateDefinition,
  customFields: readonly MetadataFieldDef[],
  options: ManifestOptions,
) {
  const fields = new Map<string, MetadataFieldDef>();
  for (const field of template.fields) if (field.scope === 'sample') fields.set(field.key, field);
  for (const field of customFields) {
    if (fields.has(field.key)) throw new Error(`Custom field "${field.key}" clashes with a template field.`);
    fields.set(field.key, field);
  }
  const keyField = template.key_field;

  // One transform over all rows, so cell errors and duplicate keys are reported together (zod skips refinements
  // on values that already have issues).
  const rows = z.array(z.record(z.string(), z.string())).transform((rawRows, ctx) => {
    const issue = (path: (string | number)[], message: string, code: string) =>
      ctx.addIssue({ code: 'custom', path, message, params: { code } });
    const firstRowOfKey = new Map<string, number>();

    return rawRows.map((raw, index) => {
      const out: ManifestRow = {};
      for (const key of Object.keys(raw)) {
        if (!fields.has(key)) issue([index, key], `Unknown column "${key}".`, 'unknown_column');
      }
      for (const [key, field] of fields) {
        const result = parseCell(field, raw[key] ?? '', key === keyField, options);
        if (!result.ok) {
          issue([index, key], result.message, result.code);
          continue;
        }
        out[key] = result.value;
        if (key === keyField && typeof result.value === 'string') {
          const first = firstRowOfKey.get(result.value);
          if (first === undefined) firstRowOfKey.set(result.value, index);
          else
            issue(
              [index, key],
              `Duplicate ${field.label.toLowerCase()} "${result.value}" (row ${first + 1}).`,
              'duplicate_key',
            );
        }
      }
      return out;
    });
  });

  return z.object({ rows });
}

export type ManifestResult =
  { ok: true; rows: ManifestRow[]; errors: [] } | { ok: false; errors: ContractError[] };

/** Validates raw manifest rows; every error names its cell as `rows.<index>.<column>`. */
export function validateManifest(
  template: MetadataTemplateDefinition,
  customFields: readonly MetadataFieldDef[],
  rows: readonly Record<string, string>[],
  options: ManifestOptions,
): ManifestResult {
  const result = buildManifestSchema(template, customFields, options).safeParse({ rows });
  return result.success
    ? { ok: true, rows: result.data.rows, errors: [] }
    : { ok: false, errors: issuesToErrors(result.error.issues) };
}
