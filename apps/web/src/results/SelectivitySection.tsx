// Compound selectivity profile (Phase 42, SEL-03): one profiling experiment at a time; the API counts and selects,
// the page only shows. Experiment and threshold live in the URL so a view can be shared.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { FigureView } from './ChartView.tsx';

/** "1 µM", "100 nM", "3.16 µM": EC50 = 10^−pEC50 M in the nearest SI unit. */
export function ec50Label(pec50: number): string {
  const molar = 10 ** -pec50;
  const [unit, factor] =
    molar >= 1e-3 ? ['mM', 1e3] : molar >= 1e-6 ? ['µM', 1e6] : molar >= 1e-9 ? ['nM', 1e9] : ['pM', 1e12];
  return `${Number((molar * factor).toPrecision(3))} ${unit}`;
}

const KNOWN = { primary_target: 'primary target', off_target: 'off-target' } as const;

export function SelectivitySection({ compoundId }: { compoundId: string }) {
  const search = useSearch({ from: '/compounds/$id' });
  const navigate = useNavigate({ from: '/compounds/$id' });
  const pec50 = Number(search.pec50 ?? 6);
  const [draft, setDraft] = useState(String(pec50));
  const result = useQuery({
    queryKey: ['selectivity', compoundId, search.sel_version, pec50],
    queryFn: () =>
      api('getCompoundSelectivity', {
        params: { id: compoundId },
        query: { ...(search.sel_version ? { version_id: search.sel_version } : {}), pec50_min: pec50 },
      }),
  });
  const r = result.data;
  if (r && r.experiments.length === 0) return null; // never profiled (or not readable): no section
  const p = r?.profile;
  const draftValue = Number(draft);
  const valid = draft.trim() !== '' && draftValue >= 3 && draftValue <= 12;
  const set = (next: { sel_version?: string; pec50?: string }) =>
    void navigate({ search: (s) => ({ ...s, ...next }), replace: true, resetScroll: false });
  return (
    <section role="region" aria-label="Selectivity" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Selectivity</h2>
      <ErrorMessage error={result.error} />
      {r && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="stack" style={{ gap: 4 }}>
            <span>Profiling experiment</span>
            <select value={r.version_id ?? ''} onChange={(e) => set({ sel_version: e.target.value })}>
              {r.experiments.map((e) => (
                <option key={e.version_id} value={e.version_id}>
                  {e.experiment_name} · {e.program_code}
                  {e.experiment_date ? ` · ${e.experiment_date}` : ''}
                  {e.method ? ` · ${e.method}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span>Potency threshold (pEC50)</span>
            <input
              type="number"
              min={3}
              max={12}
              step={0.1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={!valid}
            />
            {!valid && <span className="error">A pEC50 between 3 and 12.</span>}
          </label>
          <button type="button" disabled={!valid} onClick={() => set({ pec50: String(draftValue) })}>
            Apply
          </button>
        </div>
      )}
      {p && r && (
        <>
          <p style={{ margin: 0 }}>
            <strong>
              {p.engaged} of {p.tested} proteins tested are engaged
            </strong>{' '}
            (the tool’s up/down calls).{' '}
            {p.s_score.score === null
              ? 'No S score: no protein was tested.'
              : `S(${ec50Label(p.s_score.pec50_min)}) = ${p.s_score.engaged} / ${p.s_score.tested} = ${p.s_score.score.toFixed(3)}`}{' '}
            <span className="hint">
              (engaged with EC50 ≤ {ec50Label(p.s_score.pec50_min)}; lower is more selective)
            </span>
          </p>
          <p style={{ margin: 0 }}>
            {p.window.delta !== null && p.window.primary && p.window.next
              ? `Selectivity window: ${p.window.delta.toFixed(2)} log units (primary target ${p.window.primary.feature_id} pEC50 ${p.window.primary.pec50.toFixed(2)} vs ${p.window.next.feature_id} ${p.window.next.pec50.toFixed(2)}).`
              : `Selectivity window: ${p.window.note}`}
          </p>
          {r.figure && <FigureView label="Engaged proteins by pEC50" figure={r.figure} />}
          <table aria-label="Engaged proteins" className="data-table">
            <thead>
              <tr>
                {['feature', 'genes', 'pEC50', 'EC50', 'regulation', 'FDR (q-value)', 'annotation'].map(
                  (h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {p.proteins.map((x) => (
                <tr key={x.feature_id}>
                  <td>
                    <Link to="/proteins/$id" params={{ id: x.feature_id }}>
                      {x.feature_id}
                    </Link>
                  </td>
                  <td>{x.genes}</td>
                  <td>{x.pec50 === null ? '—' : x.pec50.toFixed(2)}</td>
                  <td>{x.pec50 === null ? '—' : ec50Label(x.pec50)}</td>
                  <td>{x.regulation}</td>
                  <td>{x.fdr === null ? '—' : x.fdr.toExponential(2)}</td>
                  <td>{x.known ? KNOWN[x.known] : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="hint" style={{ margin: 0 }}>
            {r.provenance.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
