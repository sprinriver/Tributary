import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';

/** RDKit's SVG as an image: an <img> never runs scripts, so server SVG is never injected into the page. */
export function StructureImage({ svg, alt, width = 280 }: { svg: string; alt: string; width?: number }) {
  return (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt={alt}
      width={width}
      style={{ background: '#fff', borderRadius: 6, border: '1px solid var(--border, #d6dbe1)' }}
    />
  );
}

const fixed = (v: number | null, d: number) => (v === null ? '—' : v.toFixed(d));
const count = (v: number | null) => (v === null ? '—' : String(v));

/** Structure and descriptors of a compound (Phase 28, CHEM-04). */
export function CompoundStructurePanel({ id, programId }: { id: string; programId?: string | undefined }) {
  const [batch, setBatch] = useState<string | undefined>(undefined);
  const structure = useQuery({
    queryKey: ['compound-structure', id, programId, batch],
    queryFn: () =>
      api('getCompoundStructure', {
        params: { id },
        query: { ...(programId ? { program_id: programId } : {}), ...(batch ? { batch_id: batch } : {}) },
      }),
    retry: false,
  });
  const s = structure.data;
  return (
    <section
      role="region"
      aria-label="Structure"
      className="row"
      style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}
    >
      <ErrorMessage error={structure.error} />
      {s && (
        <>
          <StructureImage svg={s.svg} alt={`Structure of ${id}: ${s.canonical_smiles}`} />
          <dl className="stack" style={{ gap: 2, margin: 0 }}>
            <dt className="hint">Canonical SMILES</dt>
            <dd style={{ margin: 0, wordBreak: 'break-all' }}>{s.canonical_smiles}</dd>
            <dt className="hint">InChIKey (computed)</dt>
            <dd style={{ margin: 0 }}>{s.inchikey ?? '—'}</dd>
            <dt className="hint">MW (average) · Crippen logP · TPSA (N, O)</dt>
            <dd style={{ margin: 0 }}>
              {fixed(s.descriptors.mw, 2)} g/mol · {fixed(s.descriptors.clogp, 2)} ·{' '}
              {fixed(s.descriptors.tpsa, 1)} Å²
            </dd>
            <dt className="hint">Lipinski donors · acceptors (NH+OH · N+O)</dt>
            <dd style={{ margin: 0 }}>
              {count(s.descriptors.lipinski_hbd)} · {count(s.descriptors.lipinski_hba)}
            </dd>
            <dt className="hint">RDKit HBD · HBA · rotatable bonds · rings</dt>
            <dd style={{ margin: 0 }}>
              {count(s.descriptors.hbd)} · {count(s.descriptors.hba)} · {count(s.descriptors.rotatable_bonds)}{' '}
              · {count(s.descriptors.rings)}
            </dd>
            {s.components > 1 && (
              <dd role="note" style={{ margin: 0 }}>
                <strong>{s.components} components</strong> (salt or mixture): descriptors and InChIKey cover
                the whole registered structure.
              </dd>
            )}
            {s.batches.length > 1 && (
              <dd style={{ margin: 0 }}>
                <label className="row" style={{ gap: 6 }}>
                  <span className="hint">Batch</span>
                  <select value={s.batch_id ?? ''} onChange={(e) => setBatch(e.target.value || undefined)}>
                    {s.batches.map((b) => (
                      <option key={b.batch_id ?? ''} value={b.batch_id ?? ''}>
                        {b.batch_id ?? '(no batch)'}
                      </option>
                    ))}
                  </select>
                </label>
                {s.batches_differ && (
                  <span role="note">
                    <strong>Batches register different structures.</strong>
                  </span>
                )}
              </dd>
            )}
            <dd className="hint" style={{ margin: 0 }}>
              Stereochemistry as registered; computed by RDKit {s.rdkit_version}
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}
