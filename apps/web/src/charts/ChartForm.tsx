import {
  CHART_REGISTRY,
  chartDefaults,
  slotAccepts,
  type ChartType,
  type ColumnType,
} from '@tributary/contracts';
import { Field } from '../components/ui.tsx';
import { controlsOf, OPTION_LABELS, slotLabel, type Control } from './controls.ts';

export interface ChartDraft {
  type: ChartType;
  encodings: Record<string, string | string[]>;
  options: Record<string, unknown>;
  xTitle: string;
  yTitle: string;
}

export const AVAILABLE_TYPES = Object.keys(CHART_REGISTRY) as ChartType[];
export const newDraft = (type: ChartType): ChartDraft => ({
  type,
  encodings: {},
  options: chartDefaults(type),
  xTitle: '',
  yTitle: '',
});

function OptionControl({
  control,
  value,
  error,
  onChange,
}: {
  control: Control;
  value: unknown;
  error?: string | undefined;
  onChange: (v: unknown) => void;
}) {
  const label = OPTION_LABELS[control.name] ?? control.name;
  if (control.kind === 'boolean') {
    return (
      <div className="field">
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }
  return (
    <Field label={label} error={error}>
      {(id) =>
        control.kind === 'enum' ? (
          <select id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {control.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            type="number"
            value={value === undefined || value === null ? '' : String(value)}
            min={control.min}
            max={control.max}
            step={control.integer ? 1 : 'any'}
            style={{ width: 120 }}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        )
      }
    </Field>
  );
}

/** Generated from the chart registry: type-aware column pickers, option controls, errors next to each control. */
export function ChartForm({
  draft,
  columns,
  errors,
  onChange,
}: {
  draft: ChartDraft;
  columns: Record<string, ColumnType>;
  errors: Record<string, string>;
  onChange: (d: ChartDraft) => void;
}) {
  const def = CHART_REGISTRY[draft.type]!;
  const setEncoding = (slot: string, value: string | string[] | undefined) => {
    const encodings = { ...draft.encodings };
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length))
      delete encodings[slot];
    else encodings[slot] = value;
    onChange({ ...draft, encodings });
  };
  const setOption = (name: string, value: unknown) => {
    const options = { ...draft.options };
    if (value === undefined) delete options[name];
    else options[name] = value;
    onChange({ ...draft, options });
  };
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {Object.entries(def.encodings).map(([slot, enc]) => {
          const label = slotLabel(draft.type, slot);
          // Type-aware pickers: only columns this slot accepts (REFERENCE_V1 §8).
          const fitting = Object.entries(columns)
            .filter(([, t]) => slotAccepts(enc.accepts, t))
            .map(([name]) => name);
          const error = errors[`encodings.${slot}`];
          if (enc.multiple) {
            const chosen = ([] as string[]).concat(draft.encodings[slot] ?? []);
            return (
              <fieldset key={slot} style={{ maxHeight: 180, overflow: 'auto', minWidth: 200 }}>
                <legend>
                  {label}
                  {enc.required ? ' *' : ''}
                </legend>
                {fitting.map((name) => (
                  <label key={name} style={{ display: 'block' }}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(name)}
                      onChange={(e) =>
                        setEncoding(
                          slot,
                          e.target.checked ? [...chosen, name] : chosen.filter((c) => c !== name),
                        )
                      }
                    />{' '}
                    {name}
                  </label>
                ))}
                {error && (
                  <span className="error" role="alert">
                    {error}
                  </span>
                )}
              </fieldset>
            );
          }
          return (
            <Field key={slot} label={label} error={error}>
              {(id) => (
                <select
                  id={id}
                  value={String(draft.encodings[slot] ?? '')}
                  onChange={(e) => setEncoding(slot, e.target.value)}
                >
                  <option value="">{enc.required ? 'Choose…' : '—'}</option>
                  {fitting.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          );
        })}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {controlsOf(draft.type).map((control) => (
          <OptionControl
            key={control.name}
            control={control}
            value={draft.options[control.name]}
            error={errors[`options.${control.name}`]}
            onChange={(v) => setOption(control.name, v)}
          />
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Field label="X axis title">
          {(id) => (
            <input
              id={id}
              value={draft.xTitle}
              onChange={(e) => onChange({ ...draft, xTitle: e.target.value })}
            />
          )}
        </Field>
        <Field label="Y axis title">
          {(id) => (
            <input
              id={id}
              value={draft.yTitle}
              onChange={(e) => onChange({ ...draft, yTitle: e.target.value })}
            />
          )}
        </Field>
      </div>
    </div>
  );
}
