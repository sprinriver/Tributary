// Target evidence of a compound (Phase 49, EVD-02): one row per protein with each line of evidence beside its own
// threshold. The API decides what counts; the page shows. No combined score is shown, because none is computed.
import type { TargetEvidence } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { ec50Label } from './SelectivitySection.tsx';

const ANNOTATION = { primary_target: 'primary target', off_target: 'off-target' } as const;
type Protein = TargetEvidence['proteins'][number];

const mark = (yes: boolean) => (yes ? '+' : '—');

function thermalText(p: Protein, adjPMax: number, name: (release: string) => string) {
  return p.thermal.map((t) => {
    const dtm =
      t.delta_tm === null ? 'no ΔTm' : `ΔTm ${t.delta_tm > 0 ? '+' : ''}${t.delta_tm.toFixed(1)} °C`;
    const p = t.adj_p_value === null ? 'not tested' : `adj. p ${t.adj_p_value.toExponential(1)}`;
    const flag = t.adj_p_value !== null && t.adj_p_value <= adjPMax ? '' : ' (above threshold)';
    return `${t.comparison} (${name(t.release_id)}): ${dtm}, ${p}${flag}${t.fulfills_all_requirements ? ', replicate checks met' : ''}`;
  });
}

export function TargetEvidenceSection({ compoundId }: { compoundId: string }) {
  const [programId, setProgramId] = useState<string | undefined>(undefined);
  const evidence = useQuery({
    queryKey: ['target-evidence', compoundId, programId],
    queryFn: () =>
      api('getTargetEvidence', {
        params: { id: compoundId },
        query: { ...(programId ? { program_id: programId } : {}), pec50_min: 6, adj_p_max: 0.05 },
      }),
  });
  const e = evidence.data;
  const name = (release: string) =>
    [...(e?.sources.dose_response ?? []), ...(e?.sources.thermal_shift ?? [])].find(
      (s) => s.release_id === release,
    )?.experiment_name ?? 'unknown experiment';
  if (e && !e.program_id) return null; // no readable data for this compound: no section
  return (
    <section role="region" aria-label="Target evidence" className="stack">
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Target evidence</h2>
      <ErrorMessage error={evidence.error} />
      {e && (
        <>
          {e.programs.length > 1 && (
            <label className="stack" style={{ gap: 4, maxWidth: 240 }}>
              <span>Program</span>
              <select value={e.program_id ?? ''} onChange={(x) => setProgramId(x.target.value)}>
                {e.programs.map((p) => (
                  <option key={p.program_id} value={p.program_id}>
                    {p.program_code}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p style={{ margin: 0 }}>
            From {e.sources.dose_response.length} dose-response and {e.sources.thermal_shift.length} thermal
            profiling dataset(s):{' '}
            {[...e.sources.dose_response, ...e.sources.thermal_shift].map((s, i) => (
              <span key={s.release_id}>
                {i > 0 ? ', ' : ''}
                <Link
                  to="/experiments/$id/results"
                  params={{ id: s.experiment_id }}
                  search={{ version: s.version_id }}
                >
                  {s.experiment_name} · {s.dataset_name}
                </Link>
              </span>
            ))}
            .
          </p>
          <ul style={{ margin: 0 }}>
            {e.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <table aria-label="Target evidence" className="data-table">
            <thead>
              <tr>
                {[
                  'protein',
                  'gene',
                  `dose-response (pEC50 ≥ ${e.thresholds.pec50_min}, EC50 ≤ ${ec50Label(e.thresholds.pec50_min)})`,
                  `thermal shift (adj. p ≤ ${e.thresholds.adj_p_max})`,
                  'annotation',
                  'matched by',
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {e.proteins.map((p) => (
                <tr key={p.key}>
                  <td>
                    {p.accession ? (
                      <Link to="/proteins/$id" params={{ id: p.accession }}>
                        {p.accession}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{p.gene ?? ''}</td>
                  <td>
                    {mark(p.lines.dose)}{' '}
                    {p.dose ? (
                      <span className="hint">
                        pEC50 {p.dose.pec50 === null ? '—' : p.dose.pec50.toFixed(2)}, {p.dose.regulation} (
                        {name(p.dose.release_id)})
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {mark(p.lines.thermal)}{' '}
                    {thermalText(p, e.thresholds.adj_p_max, name).map((line) => (
                      <div key={line} className="hint">
                        {line}
                      </div>
                    ))}
                  </td>
                  <td>{p.annotation ? `+ ${ANNOTATION[p.annotation]}` : '—'}</td>
                  <td className="hint">{p.matched_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
