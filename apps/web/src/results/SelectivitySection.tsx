// Compound selectivity profile (Phase 42, SEL-03): one profiling dataset at a time; the API counts and selects,
// the page only shows. Dataset, threshold and direction live in the URL so a view can be shared.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { FigureView } from './ChartView.tsx';

/** "1 µM", "100 nM", "3.16 µM": EC50 = 10^−pEC50 M, rounded to 3 significant figures before the unit is chosen. */
export function ec50Label(pec50: number): string {
  const molar = Number((10 ** -pec50).toPrecision(3));
  const [unit, factor] =
    molar >= 1e-3 ? ['mM', 1e3] : molar >= 1e-6 ? ['µM', 1e6] : molar >= 1e-9 ? ['nM', 1e9] : ['pM', 1e12];
  return `${Number((molar * factor).toPrecision(3))} ${unit}`;
}

const KNOWN = { primary_target: 'primary target', off_target: 'off-target' } as const;
const DIRECTIONS = { both: 'up and down', down: 'down only', up: 'up only' } as const;
type Direction = keyof typeof DIRECTIONS;

export function SelectivitySection({ compoundId }: { compoundId: string }) {
  const search = useSearch({ from: '/compounds/$id' });
  const navigate = useNavigate({ from: '/compounds/$id' });
  const pec50 = Number(search.pec50 ?? 6);
  const direction: Direction = search.sel_dir === 'down' || search.sel_dir === 'up' ? search.sel_dir : 'both';
  const [draft, setDraft] = useState(String(pec50));
  const result = useQuery({
    queryKey: ['selectivity', compoundId, search.sel_release, pec50, direction],
    queryFn: () =>
      api('getCompoundSelectivity', {
        params: { id: compoundId },
        query: {
          ...(search.sel_release ? { release_id: search.sel_release } : {}),
          pec50_min: pec50,
          direction,
        },
      }),
  });
  const r = result.data;
  if (r && r.experiments.length === 0) return null; // never profiled (or not readable): no section
  const p = r?.profile;
  const draftValue = Number(draft);
  const valid = draft.trim() !== '' && draftValue >= 3 && draftValue <= 12;
  const set = (next: { sel_release?: string; pec50?: string; sel_dir?: string }) =>
    void navigate({ search: (s) => ({ ...s, ...next }), replace: true, resetScroll: false });
  const s = p?.s_score;
  return (
    <section role="region" aria-label="Selectivity" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Selectivity</h2>
      <ErrorMessage error={result.error} />
      {r && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="stack" style={{ gap: 4 }}>
            <span>Profiling experiment</span>
            <select
              value={r.provenance.release_id ?? ''}
              onChange={(e) => set({ sel_release: e.target.value })}
            >
              {r.experiments.map((e) => (
                <option key={e.release_id} value={e.release_id}>
                  {e.experiment_name} · {e.dataset_name} · {e.program_code}
                  {e.experiment_date ? ` · ${e.experiment_date}` : ''}
                  {e.method ? ` · ${e.method}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span>Regulation counted</span>
            <select value={direction} onChange={(e) => set({ sel_dir: e.target.value })}>
              {(Object.keys(DIRECTIONS) as Direction[]).map((d) => (
                <option key={d} value={d}>
                  {DIRECTIONS[d]}
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
      {p && s && r && (
        <>
          <p style={{ margin: 0 }}>
            <strong>
              {p.regulated} of {p.tested} proteins tested are regulated
            </strong>{' '}
            ({p.regulated_down} down, {p.regulated_up} up: the tool’s calls).{' '}
            {s.score === null
              ? 'No S score: no protein was tested.'
              : `S(${ec50Label(s.pec50_min)}${direction === 'both' ? '' : `, ${DIRECTIONS[direction]}`}) = ${s.regulated} / ${s.tested} = ${s.score.toFixed(3)}`}{' '}
            <span className="hint">
              (regulated with EC50 ≤ {ec50Label(s.pec50_min)}; lower is more selective)
            </span>
          </p>
          <p style={{ margin: 0 }}>
            {p.window.delta !== null && p.window.primary && p.window.next
              ? `Selectivity window: ${p.window.delta.toFixed(2)} log units (primary target ${p.window.primary.feature_id} pEC50 ${p.window.primary.pec50.toFixed(2)} vs ${p.window.next.feature_id} ${p.window.next.pec50.toFixed(2)})${p.window.delta < 0 ? ': another protein is more potent than the primary target' : ''}.`
              : `Selectivity window: ${p.window.note}`}
          </p>
          {p.notes.length > 0 && (
            <ul style={{ margin: 0 }}>
              {p.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {r.figure && <FigureView label="Regulated proteins by pEC50" figure={r.figure} />}
          <table aria-label="Regulated proteins" className="data-table">
            <thead>
              <tr>
                {[
                  'feature',
                  'genes',
                  'pEC50',
                  'EC50',
                  'regulation',
                  'FDR (q-value)',
                  'annotation',
                  'flags',
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
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
                  <td>
                    {[x.ambiguous ? 'protein group' : '', x.outside_dose_range ? 'outside dose range' : '']
                      .filter(Boolean)
                      .join(', ')}
                  </td>
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
