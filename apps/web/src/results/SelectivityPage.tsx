// Selectivity table (Phase 43, SEL-05): every profiled compound, grouped by profiling dataset. The API counts and
// orders; the page shows. Program, threshold and direction live in the URL.
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Fragment, useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { ec50Label } from './SelectivitySection.tsx';

export interface SelectivitySearch {
  program_id?: string;
  pec50?: string;
  dir?: 'down' | 'up';
}

const DIRECTIONS = { both: 'up and down', down: 'down only', up: 'up only' } as const;
const COLUMNS = 7;

export function SelectivityPage() {
  const search = useSearch({ from: '/selectivity' });
  const navigate = useNavigate({ from: '/selectivity' });
  const pec50 = Number(search.pec50 ?? 6);
  const direction = search.dir ?? 'both';
  const [draft, setDraft] = useState(String(pec50));
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });
  const table = useQuery({
    queryKey: ['selectivity-table', search.program_id, pec50, direction],
    queryFn: () =>
      api('listSelectivity', {
        query: {
          ...(search.program_id ? { program_id: search.program_id } : {}),
          pec50_min: pec50,
          direction,
        },
      }),
  });
  const draftValue = Number(draft);
  const valid = draft.trim() !== '' && draftValue >= 3 && draftValue <= 12;
  const set = (next: { [K in keyof SelectivitySearch]?: SelectivitySearch[K] | undefined }) =>
    void navigate({
      search: (s) => {
        const merged = { ...s, ...next };
        return {
          ...(merged.program_id ? { program_id: merged.program_id } : {}),
          ...(merged.pec50 ? { pec50: merged.pec50 } : {}),
          ...(merged.dir ? { dir: merged.dir } : {}),
        };
      },
      replace: true,
    });
  const t = table.data;
  const threshold = t ? ec50Label(t.thresholds.pec50_min) : '';
  return (
    <main style={{ padding: 24 }} className="stack">
      <h1 style={{ margin: 0 }}>Selectivity</h1>
      <p style={{ margin: 0 }} className="hint">
        Every compound with dose-response curves you can read, grouped by profiling dataset.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span>Program</span>
          <select
            value={search.program_id ?? ''}
            onChange={(e) => set({ program_id: e.target.value || undefined })}
          >
            <option value="">All programs</option>
            {programs.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span>Regulation counted</span>
          <select
            value={direction}
            onChange={(e) =>
              set({ dir: e.target.value === 'down' || e.target.value === 'up' ? e.target.value : undefined })
            }
          >
            {(Object.keys(DIRECTIONS) as (keyof typeof DIRECTIONS)[]).map((d) => (
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
      <ErrorMessage error={programs.error ?? table.error} />
      {t && t.items.length === 0 && (
        <p className="hint">
          No dose-response curves yet: import a curve file (for example from CurveCurator) into an experiment.
        </p>
      )}
      {t && t.items.length > 0 && (
        <>
          {/* The caveats come before the numbers. */}
          <ul style={{ margin: 0 }}>
            {t.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <table aria-label="Compound selectivity" className="data-table">
            <thead>
              <tr>
                {[
                  'compound',
                  'tool',
                  'regulated / tested',
                  `S(${threshold})`,
                  'primary target pEC50',
                  'window (log units)',
                  'flags',
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.items.map((x, i) => (
                <Fragment key={`${x.release_id}|${x.compound_id}`}>
                  {x.release_id !== t.items[i - 1]?.release_id && (
                    <tr>
                      <th scope="colgroup" colSpan={COLUMNS} style={{ textAlign: 'left' }}>
                        {x.experiment_name} · {x.dataset_name}{' '}
                        <span className="hint">
                          ({x.program_code}
                          {x.experiment_date ? ` · ${x.experiment_date}` : ''})
                        </span>
                      </th>
                    </tr>
                  )}
                  <tr aria-label={`${x.compound_id} in ${x.experiment_name}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link
                        to="/compounds/$id"
                        params={{ id: x.compound_id }}
                        search={{
                          program_id: x.program_id,
                          sel_release: x.release_id,
                          pec50: String(t.thresholds.pec50_min),
                          ...(direction === 'both' ? {} : { sel_dir: direction }),
                        }}
                      >
                        {x.compound_id}
                      </Link>
                    </td>
                    <td>{x.method ?? ''}</td>
                    <td>
                      {x.regulated} / {x.tested}
                    </td>
                    <td>
                      {x.status === 'ranked' && x.s_score !== null
                        ? `${x.s_score.toFixed(3)} (${x.s_regulated} / ${x.tested})`
                        : x.status === 'inactive'
                          ? `Nothing regulated at EC50 ≤ ${threshold}: inactive, not selective`
                          : 'No score: nothing tested'}
                    </td>
                    <td>{x.primary ? `${x.primary.pec50.toFixed(2)} (${x.primary.feature_id})` : '—'}</td>
                    <td>
                      {x.window_delta !== null ? (
                        x.window_delta.toFixed(2)
                      ) : (
                        <span className="hint">{x.window_note}</span>
                      )}
                    </td>
                    <td className="hint">
                      {[
                        ...x.flags,
                        ...(x.regulated_without_pec50
                          ? [`${x.regulated_without_pec50} regulated without a pEC50 (not in S).`]
                          : []),
                      ].join(' ')}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
      {t && t.skipped.length > 0 && (
        <p className="hint" style={{ margin: 0 }}>
          Not read:{' '}
          {t.skipped.map((s) => `${s.experiment_name} · ${s.dataset_name} (${s.reason})`).join('; ')}
        </p>
      )}
    </main>
  );
}
