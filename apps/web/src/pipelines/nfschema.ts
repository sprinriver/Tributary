// Launch-form model from a Nextflow pipeline schema (nf-schema / nf-validation: JSON Schema with parameter groups in
// `$defs` (draft 2020-12) or `definitions` (draft-07), referenced from `allOf`). Pure functions; the form renders them.

export type FieldType = 'string' | 'integer' | 'number' | 'boolean';
export type ParamValue = string | number | boolean;

export interface FormField {
  name: string;
  type: FieldType;
  description?: string | undefined;
  help?: string | undefined;
  enum?: (string | number)[] | undefined;
  default?: ParamValue | undefined;
  required: boolean;
  pattern?: string | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  /** nf-schema formats: file-path, directory-path, path, file-path-pattern. */
  format?: string | undefined;
}

export interface FieldGroup {
  title: string;
  fields: FormField[];
}

export interface ParamError {
  field: string;
  code: 'required' | 'invalid_type' | 'too_small' | 'too_big' | 'invalid_value' | 'invalid_format';
  message: string;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function toField(name: string, spec: Json, required: boolean): FormField | null {
  if (spec.hidden === true) return null;
  const t = spec.type;
  const type: FieldType = t === 'integer' || t === 'number' || t === 'boolean' ? t : 'string';
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    name,
    type,
    description: str(spec.description),
    help: str(spec.help_text),
    enum: Array.isArray(spec.enum) ? (spec.enum as (string | number)[]) : undefined,
    default: ['string', 'number', 'boolean'].includes(typeof spec.default)
      ? (spec.default as ParamValue)
      : undefined,
    required,
    pattern: str(spec.pattern),
    minimum: num(spec.minimum),
    maximum: num(spec.maximum),
    format: str(spec.format),
  };
}

function group(title: string, def: Json): FieldGroup {
  const required = new Set(Array.isArray(def.required) ? (def.required as string[]) : []);
  const props = isObject(def.properties) ? def.properties : {};
  const fields = Object.entries(props)
    .map(([name, spec]) => (isObject(spec) ? toField(name, spec, required.has(name)) : null))
    .filter((f): f is FormField => f !== null);
  return { title, fields };
}

/** Field groups in schema order: `allOf` references first, then any top-level properties. */
export function formFields(schema: unknown): FieldGroup[] {
  if (!isObject(schema)) return [];
  const defs = (
    isObject(schema.$defs) ? schema.$defs : isObject(schema.definitions) ? schema.definitions : {}
  ) as Json;
  const groups: FieldGroup[] = [];
  const seen = new Set<string>();
  for (const ref of Array.isArray(schema.allOf) ? schema.allOf : []) {
    const target = isObject(ref) && typeof ref.$ref === 'string' ? ref.$ref.split('/').at(-1)! : undefined;
    const def = target ? defs[target] : undefined;
    if (!target || !isObject(def)) continue;
    seen.add(target);
    groups.push(group(typeof def.title === 'string' ? def.title : target, def));
  }
  for (const [name, def] of Object.entries(defs)) {
    if (!seen.has(name) && isObject(def))
      groups.push(group(typeof def.title === 'string' ? def.title : name, def));
  }
  if (isObject(schema.properties)) groups.push(group('Parameters', schema));
  return groups.filter((g) => g.fields.length > 0);
}

/** Parses and checks form values (strings from inputs) against the fields; defaults fill blanks. */
export function validateParams(
  fields: FormField[],
  values: Record<string, unknown>,
):
  | { ok: true; values: Record<string, ParamValue>; errors?: undefined }
  | { ok: false; errors: ParamError[]; values?: undefined } {
  const errors: ParamError[] = [];
  const out: Record<string, ParamValue> = {};
  for (const f of fields) {
    let raw = values[f.name];
    if (raw === undefined || raw === '') raw = f.default;
    if (raw === undefined || raw === '') {
      if (f.required) errors.push({ field: f.name, code: 'required', message: `${f.name} is required.` });
      continue;
    }
    let value: ParamValue;
    if (f.type === 'boolean') {
      value = raw === true || raw === 'true';
    } else if (f.type === 'integer' || f.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) {
        errors.push({
          field: f.name,
          code: 'invalid_type',
          message: `${f.name} must be ${f.type === 'integer' ? 'a whole number' : 'a number'}.`,
        });
        continue;
      }
      if (f.minimum !== undefined && n < f.minimum) {
        errors.push({ field: f.name, code: 'too_small', message: `${f.name} must be ≥ ${f.minimum}.` });
        continue;
      }
      if (f.maximum !== undefined && n > f.maximum) {
        errors.push({ field: f.name, code: 'too_big', message: `${f.name} must be ≤ ${f.maximum}.` });
        continue;
      }
      value = n;
    } else {
      value = String(raw);
      if (f.pattern && !new RegExp(f.pattern).test(value)) {
        errors.push({ field: f.name, code: 'invalid_format', message: `${f.name} must match ${f.pattern}.` });
        continue;
      }
    }
    if (f.enum && !f.enum.map(String).includes(String(value))) {
      errors.push({
        field: f.name,
        code: 'invalid_value',
        message: `${f.name} must be one of ${f.enum.join(', ')}.`,
      });
      continue;
    }
    out[f.name] = value;
  }
  return errors.length ? { ok: false, errors } : { ok: true, values: out };
}

/** Experiment facts a launch form may be prefilled with (SPEC M4 "prefill from experiment"). */
export interface PrefillSource {
  species: { id: string; label: string } | null;
  contrasts: { label: string; numerator: string; denominator: string }[];
}

// Conventional parameter names; a pipeline whose schema uses none of them gets no prefill.
const SPECIES_PARAMS = ['organism', 'species'];
const CONTRAST_PARAMS = ['contrasts', 'contrast'];

/** Values for string fields named after experiment facts. Contrast labels read "numerator vs denominator". */
export function experimentPrefill(fields: FormField[], source: PrefillSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f.type !== 'string') continue;
    if (SPECIES_PARAMS.includes(f.name) && source.species) out[f.name] = source.species.label;
    if (CONTRAST_PARAMS.includes(f.name) && source.contrasts.length)
      out[f.name] = source.contrasts.map((c) => c.label).join(';');
  }
  return out;
}
