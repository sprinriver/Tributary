import {
  chartDefaults,
  validateChartSpec,
  type ChartSpec,
  type DATASET_CONTRACTS,
} from '@tributary/contracts';
import { useState } from 'react';
import { OptionControl } from '../charts/ChartForm.tsx';
import { controlsOf, optionLabel } from '../charts/controls.ts';
import { ChartView, LAYOUT } from './ChartView.tsx';

type Where = NonNullable<Extract<ChartSpec['data'], { source: unknown }>['where']>;

/** SPEC M8 dose-response viewer: filters (regulation, FDR, how many, order) from the registry; Apply redraws. */
export function DoseResponseViewer({
  source,
  where,
}: {
  source: Extract<ChartSpec['data'], { source: unknown }>['source'];
  where?: Where;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => chartDefaults('dose_response'));
  const [applied, setApplied] = useState(draft);
  const spec = (options: Record<string, unknown>): ChartSpec =>
    ({
      type: 'dose_response',
      title: undefined,
      data: { source, ...(where ? { where } : {}) },
      encodings: { label: 'feature_id', panel: 'compound_id' },
      options,
      layout: LAYOUT,
    }) as unknown as ChartSpec;
  const columns = { feature_id: 'text', compound_id: 'text' } as Record<
    string,
    (typeof DATASET_CONTRACTS)['dose_response']['columns'][number]['type']
  >;
  // Cheap to validate on every render (the same registry check the server runs).
  const errors = Object.fromEntries(
    validateChartSpec(spec(draft), columns).map((e) => [e.field ?? '', e.message]),
  );
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {controlsOf('dose_response').map((c) => (
          <OptionControl
            key={c.name}
            label={optionLabel('dose_response', c.name)}
            control={c}
            value={draft[c.name]}
            error={errors[`options.${c.name}`]}
            onChange={(v) =>
              setDraft((d) => {
                const next = { ...d };
                if (v === undefined) delete next[c.name];
                else next[c.name] = v;
                return next;
              })
            }
          />
        ))}
        <button
          type="button"
          className="primary"
          disabled={Object.keys(errors).length > 0}
          onClick={() => setApplied(draft)}
        >
          Apply
        </button>
      </div>
      <ChartView spec={spec(applied)} />
    </div>
  );
}
