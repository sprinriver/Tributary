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

function thermalLines(p: Protein, name: (release: string) => string): string[] {
  return (p.thermal?.rows ?? []).map((t) => {
    const dtm =
      t.delta_tm === null ? 'no ΔTm' : `ΔTm ${t.delta_tm > 0 ? '+' : ''}${t.delta_tm.toFixed(1)} °C`;
    const p =
      t.adj_p_value === null ? 'did not pass TPP filter (no p)' : `adj. p ${t.adj_p_value.toExponential(1)}`;
    return `${t.comparison} (${name(t.release_id)}): ${dtm}, ${p}`;
  });
}

const CHECKS = {
  met: 'TPP replicate checks met',
  'not met': 'TPP replicate checks not met',
  'not computed': 'TPP replicate checks not computed (not a 2 × 2 design)',
} as const;

function matchedBy(p: Protein): string {
  const all = new Set([
    ...(p.dose?.datasets ?? []).map((d) => d.matched_by),
    ...(p.thermal?.rows ?? []).map((r) => r.matched_by),
    ...(p.annotation ? [p.annotation.matched_by] : []),
  ]);
  return [...all].join('; ');
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
                  'thermal shift',
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
                    <span className="hint">
                      {!p.dose
                        ? 'not measured'
                        : p.dose.best
                          ? `pEC50 ${p.dose.best.pec50 === null ? '— (no pEC50)' : p.dose.best.pec50.toFixed(2)}, ${p.dose.best.regulation} (${name(p.dose.best.release_id)}); regulated in ${p.dose.regulated} of ${p.dose.tested} dataset(s)`
                          : `tested, not regulated (${p.dose.tested} dataset(s))`}
                      {p.ambiguous_group && p.dose?.best ? `; from the group ${p.dose.best.feature_id}` : ''}
                    </span>
                  </td>
                  <td>
                    {mark(p.lines.thermal)}{' '}
                    {p.thermal ? (
                      <>
                        <span className="hint">
                          {p.thermal.direction}; {CHECKS[p.thermal.replicate_checks]}
                          {p.thermal.basis === 'all_comparisons'
                            ? `; every comparison at adj. p ≤ ${e.thresholds.adj_p_max} with one sign`
                            : ''}
                        </span>
                        {thermalLines(p, name).map((line) => (
                          <div key={line} className="hint">
                            {line}
                          </div>
                        ))}
                      </>
                    ) : (
                      <span className="hint">not measured</span>
                    )}
                  </td>
                  <td>
                    {p.annotation ? `+ ${ANNOTATION[p.annotation.role]}` : '—'}
                    {p.annotation && !p.dose && !p.thermal ? (
                      <div className="hint">annotated; not measured here</div>
                    ) : null}
                  </td>
                  <td className="hint">{matchedBy(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
