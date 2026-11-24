// Thermal proteome profiling results (Phase 46, TPP-04): the ΔTm plot, a table and melting curves of one
// thermal_shift release. Everything shown is the source tool's own value; the page computes nothing.
import { chartDefaults, validateChartSpec, type ChartSpec, type ChartType } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { OptionControl } from '../charts/ChartForm.tsx';
import { controlsOf, optionLabel } from '../charts/controls.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { ChartView, LAYOUT } from './ChartView.tsx';

const ROWS = 100;
const COLUMNS = { feature_id: 'text', comparison: 'text' } as const;

/** A registry chart with its option controls; Apply redraws (the same pattern as the dose-response viewer). */
function OptionsChart({ type, release }: { type: ChartType; release: string }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => chartDefaults(type));
  const [applied, setApplied] = useState(draft);
  const spec = (options: Record<string, unknown>): ChartSpec =>
    ({
      type,
      data: { source: { releaseIds: [release] } },
      encodings: { label: 'feature_id', panel: 'comparison' },
      options,
      layout: LAYOUT,
    }) as ChartSpec;
  const errors = Object.fromEntries(
    validateChartSpec(spec(draft), COLUMNS).map((e) => [e.field ?? '', e.message]),
  );
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {controlsOf(type).map((c) => (
          <OptionControl
            key={c.name}
            label={optionLabel(type, c.name)}
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

const fixed = (v: unknown, digits = 2) => (v === null || v === undefined ? '—' : Number(v).toFixed(digits));
const yesNo = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : '—');

function ShiftTable({ release }: { release: string }) {
  const shifts = useQuery({
    queryKey: ['thermal-shifts', release],
    queryFn: () =>
      api('runQuery', {
        body: {
          source: { releaseIds: [release] },
          select: [
            'feature_id',
            'gene_names',
            'comparison',
            'melt_point_vehicle',
            'melt_point_treatment',
            'delta_tm',
            'adj_p_value',
            'passed_filter',
            'fulfills_all_requirements',
          ],
          orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
          page: { size: ROWS },
        },
      }),
  });
  const rows = shifts.data?.rows ?? [];
  return (
    <>
      <ErrorMessage error={shifts.error} />
      <table aria-label="Thermal shifts" className="data-table">
        <thead>
          <tr>
            {[
              'feature',
              'genes',
              'comparison',
              'Tm vehicle (°C)',
              'Tm treatment (°C)',
              'ΔTm (°C)',
              'adjusted p',
              'passed the tool’s filter',
              'all replicate checks met',
            ].map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{String(r.feature_id)}</td>
              <td>{Array.isArray(r.gene_names) ? r.gene_names.join('; ') : ''}</td>
              <td>{String(r.comparison)}</td>
              <td>{fixed(r.melt_point_vehicle)}</td>
              <td>{fixed(r.melt_point_treatment)}</td>
              <td>{fixed(r.delta_tm)}</td>
              <td>
                {r.adj_p_value === null || r.adj_p_value === undefined
                  ? 'not tested'
                  : Number(r.adj_p_value).toExponential(2)}
              </td>
              <td>{yesNo(r.passed_filter)}</td>
              <td>{yesNo(r.fulfills_all_requirements)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === ROWS && (
        <p className="hint" style={{ margin: 0 }}>
          The first {ROWS} rows by adjusted p. Open the dataset in the explorer for all rows.
        </p>
      )}
    </>
  );
}

export function ThermalShiftSection({ release }: { release: string }) {
  return (
    <section role="region" aria-label="Thermal shift" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Thermal shift</h2>
      {/* The caveats come before the numbers. */}
      <ul style={{ margin: 0 }}>
        <li>ΔTm = melting point of the treatment − vehicle: positive means the protein is stabilised.</li>
        <li>
          Melting points, ΔTm and adjusted p-values are the analysis tool’s own values; nothing is refitted or
          retested here. “Not tested” means the comparison failed the tool’s curve-quality filter or had no
          fit.
        </li>
        <li>
          Each comparison is one replicate pair. The tool’s hit call across replicates is the column “all
          replicate checks met” (diamonds in the plot).
        </li>
      </ul>
      <OptionsChart type="thermal_shift" release={release} />
      <ShiftTable release={release} />
      <h3 style={{ margin: 0, fontSize: '1rem' }}>Melting curves</h3>
      <OptionsChart type="melting_curve" release={release} />
    </section>
  );
}
