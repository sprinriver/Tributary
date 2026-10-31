import type { ChartSpec } from '../charts.ts';
import { CHART_REGISTRY } from '../charts.ts';
import type { ColumnType } from '../datasets/index.ts';
import { issuesToErrors, type ContractError } from '../errors.ts';

const CLASS: Record<ColumnType, 'numeric' | 'categorical' | 'temporal' | 'json'> = {
  double: 'numeric',
  integer: 'numeric',
  text: 'categorical',
  uuid: 'categorical',
  boolean: 'categorical',
  'text[]': 'categorical',
  'double[]': 'numeric',
  date: 'temporal',
  timestamp: 'temporal',
  json: 'json',
};

/** Encoding slot accepts a column type (type-aware pickers use the same test). */
export function slotAccepts(accepts: readonly string[], type: ColumnType): boolean {
  return accepts.includes('any') ? CLASS[type] !== 'json' : accepts.includes(CLASS[type]);
}

/** Every chart rule before any data is read: encodings (required, known, typed), options, cross-field rules. */
export function validateChartSpec(spec: ChartSpec, columns: Record<string, ColumnType>): ContractError[] {
  const def = CHART_REGISTRY[spec.type];
  if (!def)
    return [{ code: 'not_available', field: 'type', message: `${spec.type} charts are not available yet.` }];
  const errors: ContractError[] = [];
  for (const [slot, value] of Object.entries(spec.encodings)) {
    const field = `encodings.${slot}`;
    const enc = def.encodings[slot as keyof typeof def.encodings];
    if (!enc) {
      errors.push({ code: 'not_supported', field, message: `${def.label} has no ${slot} encoding.` });
      continue;
    }
    const names = Array.isArray(value) ? value : [value];
    if (names.length > 1 && !enc.multiple) {
      errors.push({ code: 'single', field, message: `Pick one column for ${slot}.` });
      continue;
    }
    const unknown = names.find((n) => !(n in columns));
    if (unknown) {
      errors.push({ code: 'unknown_column', field, message: `"${unknown}" is not a column of this data.` });
      continue;
    }
    const wrong = names.find((n) => !slotAccepts(enc.accepts, columns[n]!));
    if (wrong)
      errors.push({
        code: 'wrong_type',
        field,
        message: `${slot} needs ${enc.accepts.join(' or ')} columns; "${wrong}" is not.`,
      });
  }
  for (const [slot, enc] of Object.entries(def.encodings))
    if (enc.required && spec.encodings[slot as keyof typeof spec.encodings] === undefined)
      errors.push({ code: 'required', field: `encodings.${slot}`, message: `Choose a column for ${slot}.` });

  const parsed = def.options.safeParse(spec.options);
  if (!parsed.success) {
    // A field's own type/range error wins over cross-field rules on the same field (zod 4 runs both).
    const own = new Set(parsed.error.issues.filter((i) => i.code !== 'custom').map((i) => i.path.join('.')));
    for (const issue of parsed.error.issues) {
      if (issue.code === 'custom' && own.has(issue.path.join('.'))) continue;
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys)
          errors.push({
            code: 'unknown_option',
            field: `options.${key}`,
            message: `${def.label} has no "${key}" option.`,
          });
      } else {
        for (const e of issuesToErrors([issue]))
          errors.push({ ...e, field: `options${e.field ? `.${e.field}` : ''}` });
      }
    }
    return errors;
  }
  return [...errors, ...(def.rules?.(spec, parsed.data) ?? [])];
}
