import { Field } from '../components/ui.tsx';
import type { FieldGroup, ParamError } from './nfschema.ts';

/** Inputs generated from nf-schema groups; values are kept as strings/booleans until validated. */
export function ParamsForm({
  groups,
  values,
  errors,
  onChange,
}: {
  groups: FieldGroup[];
  values: Record<string, string | boolean>;
  errors: ParamError[];
  onChange: (name: string, value: string | boolean) => void;
}) {
  if (!groups.length) return <p className="hint">This pipeline declares no parameters.</p>;
  return (
    <div className="stack">
      {groups.map((g) => (
        <fieldset key={g.title} className="stack">
          <legend>{g.title}</legend>
          {g.fields.map((f) => {
            const error = errors.find((e) => e.field === f.name)?.message;
            const hint = [f.description, f.help].filter(Boolean).join(' — ') || undefined;
            const value = values[f.name];
            if (f.type === 'boolean') {
              return (
                <label key={f.name} className="row" style={{ gap: 6 }} title={hint}>
                  <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => onChange(f.name, e.target.checked)}
                  />
                  {f.name}
                </label>
              );
            }
            return (
              <Field key={f.name} label={`${f.name}${f.required ? ' *' : ''}`} hint={hint} error={error}>
                {(id) =>
                  f.enum ? (
                    <select
                      id={id}
                      aria-label={f.name}
                      value={String(value ?? '')}
                      onChange={(e) => onChange(f.name, e.target.value)}
                    >
                      {!f.required && <option value="">—</option>}
                      {f.enum.map((o) => (
                        <option key={String(o)} value={String(o)}>
                          {String(o)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      aria-label={f.name}
                      inputMode={f.type === 'string' ? undefined : 'decimal'}
                      value={String(value ?? '')}
                      onChange={(e) => onChange(f.name, e.target.value)}
                    />
                  )
                }
              </Field>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

/** Starting values: definition defaults, then schema defaults, then explicit values (re-run). */
export function initialValues(
  groups: FieldGroup[],
  defaults: Record<string, string | number | boolean>,
  explicit: Record<string, string | number | boolean> = {},
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const f of groups.flatMap((g) => g.fields)) {
    const v = explicit[f.name] ?? defaults[f.name] ?? f.default;
    if (v === undefined) continue;
    out[f.name] = typeof v === 'boolean' ? v : String(v);
  }
  return out;
}
