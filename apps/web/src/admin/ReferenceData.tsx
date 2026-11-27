import { useMutation } from '@tanstack/react-query';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';

/** Public annotation plan, stage 1 (UNI-01): refresh protein facts from UniProt for the proteins in results. */
export function ReferenceDataCard() {
  const refresh = useMutation({
    mutationFn: () => api('refreshUniprot', { body: {}, reason: 'Refresh protein facts from UniProt' }),
  });
  const r = refresh.data;
  return (
    <section className="card stack" aria-label="Reference data">
      <h2 style={{ margin: 0 }}>Reference data</h2>
      <p style={{ margin: 0 }}>
        Protein names, function, location in the cell and organism from UniProt, for every protein in
        published results. Only UniProt accessions are sent; synthetic and in-house identifiers never leave
        this installation. Each refresh records the UniProt release and keeps the previous facts.
      </p>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          {refresh.isPending ? 'Refreshing from UniProt…' : 'Refresh protein facts from UniProt'}
        </button>
        <span style={{ color: 'var(--muted)' }}>UniProt data: CC BY 4.0</span>
      </div>
      <ErrorMessage error={refresh.error} />
      {r && (
        <div role="status" className="stack" style={{ gap: 4 }}>
          <p style={{ margin: 0 }}>
            UniProt release <strong>{r.release}</strong>
            {r.release_date ? ` (${r.release_date})` : ''}: facts stored for {r.updated} of {r.requested}{' '}
            proteins.
          </p>
          {r.skipped > 0 && (
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              {r.skipped} identifier(s) in results are not UniProt accessions and were not sent.
            </p>
          )}
          {r.not_found.length > 0 && (
            <details>
              <summary>
                {r.not_found.length} accession(s) not found in this UniProt release (obsolete, merged or
                unknown)
              </summary>
              <p style={{ margin: 0, wordBreak: 'break-word' }}>{r.not_found.join(', ')}</p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
