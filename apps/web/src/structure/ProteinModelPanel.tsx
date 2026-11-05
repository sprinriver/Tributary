import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';

/** AlphaFold DB's pLDDT bands, as Mol* colours them. */
const PLDDT_BANDS = [
  { label: 'Very high (> 90)', color: '#0053D6' },
  { label: 'Confident (70–90)', color: '#65CBF3' },
  { label: 'Low (50–70)', color: '#FFDB13' },
  { label: 'Very low (≤ 50)', color: '#FF7D45' },
];

/**
 * 3D model of a protein (Phase 29, STRUC-03): where it comes from, how confident it is, and the model itself in Mol*
 * on demand. The file comes from this API (same origin) and is handed to Mol* as text.
 */
export function ProteinModelPanel({ accession }: { accession: string }) {
  const model = useQuery({
    queryKey: ['protein-model', accession],
    queryFn: () => api('getProteinModel', { params: { id: accession } }),
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const m = model.data;

  useEffect(() => {
    if (!open || !m || !host.current) return;
    let disposed = false;
    let mounted: { dispose(): void } | undefined;
    setStatus('loading');
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api${m.model_path}`);
        if (!res.ok) throw new Error(`The model file could not be read (HTTP ${res.status}).`);
        const cif = await res.text();
        const { mountModel } = await import('./molstar-view.ts');
        if (disposed || !host.current) return;
        mounted = await mountModel(
          host.current,
          cif,
          `${accession} (${m.source_label})`,
          m.confidence_metric === 'pLDDT',
        );
        if (disposed) mounted.dispose();
        else setStatus('ready');
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e : new Error(String(e)));
      }
    })();
    return () => {
      disposed = true;
      mounted?.dispose();
    };
  }, [open, m, accession]);

  if (model.error instanceof ApiError && model.error.status === 404)
    return (
      <p className="hint" style={{ margin: 0 }}>
        No 3D model is available for {accession}.
      </p>
    );
  return (
    <div className="stack">
      <ErrorMessage error={model.error} />
      {m && (
        <>
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? 'Hide 3D model' : 'Show 3D model'}
            </button>
            <span className="hint">
              {m.predicted ? 'Predicted model' : 'Model'} from {m.source_label}
              {m.entry_id ? ` · ${m.entry_id}` : ''}
              {m.licence ? ` · ${m.licence}` : ''}
            </span>
          </div>
          {m.notes.map((n) => (
            <p key={n} role="note" className="hint" style={{ margin: 0 }}>
              {n}
            </p>
          ))}
          {open && (
            <>
              {status === 'loading' && <p role="status">Loading the 3D viewer…</p>}
              {error && <ErrorMessage error={error} />}
              <div
                ref={host}
                aria-label={`3D model of ${accession}`}
                role="img"
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 440,
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              />
              {m.confidence_metric === 'pLDDT' && (
                <ul
                  aria-label="pLDDT colour key"
                  className="row hint"
                  style={{ listStyle: 'none', padding: 0, margin: 0, flexWrap: 'wrap' }}
                >
                  <li>Coloured by pLDDT (per-residue model confidence):</li>
                  {PLDDT_BANDS.map((b) => (
                    <li key={b.label} className="row" style={{ gap: 4, alignItems: 'center' }}>
                      <span
                        aria-hidden
                        style={{
                          width: 12,
                          height: 12,
                          background: b.color,
                          borderRadius: 2,
                          display: 'inline-block',
                        }}
                      />
                      {b.label}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
