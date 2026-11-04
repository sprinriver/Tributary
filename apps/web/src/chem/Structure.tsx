import { useQuery } from '@tanstack/react-query';
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

const fixed = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** Structure and descriptors of a compound (Phase 28, CHEM-04). */
export function CompoundStructurePanel({ id }: { id: string }) {
  const structure = useQuery({
    queryKey: ['compound-structure', id],
    queryFn: () => api('getCompoundStructure', { params: { id } }),
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
            <dt className="hint">MW · cLogP · TPSA</dt>
            <dd style={{ margin: 0 }}>
              {fixed(s.descriptors.mw, 2)} g/mol · {fixed(s.descriptors.clogp, 2)} ·{' '}
              {fixed(s.descriptors.tpsa, 1)} Å²
            </dd>
            <dt className="hint">HBD · HBA · rotatable bonds · rings</dt>
            <dd style={{ margin: 0 }}>
              {s.descriptors.hbd} · {s.descriptors.hba} · {s.descriptors.rotatable_bonds} ·{' '}
              {s.descriptors.rings}
            </dd>
            <dd className="hint" style={{ margin: 0 }}>
              Computed by RDKit {s.rdkit_version}
            </dd>
          </dl>
        </>
      )}
    </section>
  );
}
