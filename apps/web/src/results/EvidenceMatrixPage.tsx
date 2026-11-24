// Compound × protein evidence matrix (Phase 51, EVD-04). The API applies the compound page's rules; the page shows
// each cell's lines with letters and symbols, and a legend. No combined score is shown, because none is computed.
import type { EvidenceMatrix } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';

type Cell = EvidenceMatrix['proteins'][number]['cells'][string];
const ARROW = { stabilised: '↑', destabilised: '↓', inconsistent: '↕', none: '' } as const;

function cellText(c: Cell | undefined): string {
  if (!c) return '';
  return [
    c.dose ? `D${c.pec50 === null ? '' : ` ${c.pec50.toFixed(1)}`}` : '',
    c.thermal ? `T${c.direction ? ARROW[c.direction] : ''}` : '',
    c.annotation === 'primary_target' ? '★' : c.annotation === 'off_target' ? '○' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function cellLabel(c: Cell | undefined): string {
  if (!c) return 'no line met';
  const parts = [
    c.dose ? `dose-response line met, pEC50 ${c.pec50?.toFixed(2) ?? 'none'}` : '',
    c.thermal ? `thermal line met, ${c.direction ?? ''}` : '',
    c.annotation ? `annotated ${c.annotation === 'primary_target' ? 'primary target' : 'off-target'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : 'no line met';
}

export function EvidenceMatrixPage() {
  const [programId, setProgramId] = useState<string | undefined>(undefined);
  const matrix = useQuery({
    queryKey: ['evidence-matrix', programId],
    queryFn: () =>
      api('getEvidenceMatrix', {
        query: {
          ...(programId ? { program_id: programId } : {}),
          pec50_min: 6,
          adj_p_max: 0.05,
          max_proteins: 200,
          max_compounds: 50,
        },
      }),
  });
  const m = matrix.data;
  return (
    <main style={{ padding: 24 }} className="stack">
      <h1 style={{ margin: 0 }}>Target evidence</h1>
      <p style={{ margin: 0 }} className="hint">
        Which compounds of a program have which lines of evidence on which proteins.
      </p>
      <ErrorMessage error={matrix.error} />
      {m && !m.program_id && (
        <p className="hint">No dose-response or thermal profiling data in the programs you can read yet.</p>
      )}
      {m && m.program_id && (
        <>
          {m.programs.length > 1 && (
            <label className="stack" style={{ gap: 4, maxWidth: 240 }}>
              <span>Program</span>
              <select value={m.program_id} onChange={(e) => setProgramId(e.target.value)}>
                {m.programs.map((p) => (
                  <option key={p.program_id} value={p.program_id}>
                    {p.program_code}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ul
            aria-label="Legend"
            className="row"
            style={{ listStyle: 'none', padding: 0, margin: 0, gap: 20, flexWrap: 'wrap' }}
          >
            <li>
              <strong>D 7.2</strong> dose-response: regulated, pEC50 ≥ {m.thresholds.pec50_min} (best pEC50)
            </li>
            <li>
              <strong>T↑ / T↓ / T↕</strong> thermal shift line met: stabilised / destabilised / inconsistent
            </li>
            <li>
              <strong>★ / ○</strong> annotated primary target / off-target
            </li>
          </ul>
          <ul style={{ margin: 0 }}>
            {m.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div style={{ overflowX: 'auto' }}>
            <table aria-label="Compound × protein evidence" className="data-table">
              <thead>
                <tr>
                  <th scope="col">protein</th>
                  <th scope="col">gene</th>
                  {m.compounds.map((c) => (
                    <th
                      key={c.compound_id}
                      scope="col"
                      title={`${c.dose_datasets} dose-response, ${c.thermal_datasets} thermal profiling dataset(s)`}
                    >
                      <Link to="/compounds/$id" params={{ id: c.compound_id }}>
                        {c.compound_id}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.proteins.map((p) => (
                  <tr key={p.key}>
                    <td>
                      {p.accession ? (
                        <Link to="/proteins/$id" params={{ id: p.accession }}>
                          {p.accession}
                        </Link>
                      ) : (
                        p.key
                      )}
                    </td>
                    <td>{p.gene ?? ''}</td>
                    {m.compounds.map((c) => (
                      <td
                        key={c.compound_id}
                        aria-label={`${p.gene ?? p.key}, ${c.compound_id}: ${cellLabel(p.cells[c.compound_id])}`}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {cellText(p.cells[c.compound_id])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
