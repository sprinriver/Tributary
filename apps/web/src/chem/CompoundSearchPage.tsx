import { CompoundSearchBodySchema, type CompoundSearchBody } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { StructureImage } from './Structure.tsx';

export interface CompoundSearchSearch {
  q?: string;
  mode?: 'substructure' | 'similarity';
  type?: 'smarts' | 'smiles';
  min?: number;
}

/**
 * Structure search (Phase 28, CHEM-04): substructure (SMARTS) or similarity (SMILES). The query lives in the URL so a
 * search can be shared; RDKit runs in the API.
 */
export function CompoundSearchPage() {
  const search = useSearch({ from: '/compounds/search' });
  const navigate = useNavigate({ from: '/compounds/search' });
  const [draft, setDraft] = useState({
    q: search.q ?? '',
    mode: search.mode ?? 'substructure',
    type: search.type ?? 'smarts',
    min: String(search.min ?? 0.5),
  });
  const parsed = CompoundSearchBodySchema.safeParse({
    query: draft.q,
    mode: draft.mode,
    ...(draft.mode === 'similarity' ? { min_similarity: Number(draft.min) } : { query_type: draft.type }),
  });
  const errors = parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? ''), i.message]));
  const body: CompoundSearchBody | null = search.q
    ? CompoundSearchBodySchema.parse({
        query: search.q,
        mode: search.mode ?? 'substructure',
        ...(search.mode === 'similarity'
          ? search.min !== undefined
            ? { min_similarity: search.min }
            : {}
          : { query_type: search.type ?? 'smarts' }),
      })
    : null;
  const results = useQuery({
    queryKey: ['compound-search', body],
    queryFn: () => api('searchCompounds', { body: body! }),
    enabled: body !== null,
    retry: false,
  });
  const submit = () => {
    if (!parsed.success) return;
    void navigate({
      search: {
        q: parsed.data.query,
        mode: parsed.data.mode,
        ...(parsed.data.mode === 'similarity'
          ? { min: parsed.data.min_similarity }
          : { type: parsed.data.query_type }),
      },
    });
  };
  const r = results.data;
  return (
    <main className="stack">
      <h1 style={{ margin: 0 }}>Structure search</h1>
      <form
        className="row"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="stack" style={{ gap: 4, flex: '1 1 20rem' }}>
          <span>
            {draft.mode === 'substructure' ? 'Substructure (SMARTS or SMILES)' : 'Similar to (SMILES)'}
          </span>
          <input
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
            placeholder="c1ccccc1NC(=O)"
            spellCheck={false}
          />
          {errors.query && <span className="error">{errors.query}</span>}
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span>Search for</span>
          <select
            value={draft.mode}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                mode: e.target.value === 'similarity' ? 'similarity' : 'substructure',
              }))
            }
          >
            <option value="substructure">substructure</option>
            <option value="similarity">similarity</option>
          </select>
        </label>
        {draft.mode === 'substructure' && (
          <label className="stack" style={{ gap: 4 }}>
            <span>Read query as</span>
            <select
              value={draft.type}
              onChange={(e) =>
                setDraft((d) => ({ ...d, type: e.target.value === 'smiles' ? 'smiles' : 'smarts' }))
              }
            >
              <option value="smarts">SMARTS (atoms as written)</option>
              <option value="smiles">SMILES (aromatised molecule)</option>
            </select>
          </label>
        )}
        {draft.mode === 'similarity' && (
          <label className="stack" style={{ gap: 4 }}>
            <span>Tanimoto at least</span>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max="1"
              value={draft.min}
              onChange={(e) => setDraft((d) => ({ ...d, min: e.target.value }))}
              style={{ width: '6rem' }}
            />
            {errors.min_similarity && <span className="error">{errors.min_similarity}</span>}
          </label>
        )}
        <button type="submit" className="primary" disabled={!parsed.success}>
          Search
        </button>
      </form>
      <ErrorMessage error={results.error} />
      {results.isFetching && <p role="status">Searching structures…</p>}
      {r && (
        <>
          <p role="status" style={{ margin: 0 }}>
            {r.total_hits} hit{r.total_hits === 1 ? '' : 's'} in {r.searched} structures
            {r.items.length < r.total_hits ? ` · first ${r.items.length} shown` : ''}
          </p>
          <table aria-label="Structure search results" className="data-table">
            <thead>
              <tr>
                {[
                  'structure',
                  'compound',
                  'program',
                  r.provenance.mode === 'similarity' ? 'Tanimoto' : 'matches (first highlighted)',
                ].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.items.map((h) => (
                <tr key={`${h.program_code}|${h.compound_id}|${h.smiles}`}>
                  <td>
                    <StructureImage
                      svg={h.svg}
                      alt={`Structure of ${h.compound_id}: ${h.smiles}`}
                      width={180}
                    />
                  </td>
                  <td>
                    <Link
                      to="/compounds/$id"
                      params={{ id: h.compound_id }}
                      search={{ program_id: h.program_id }}
                    >
                      {h.compound_id}
                    </Link>
                    <br />
                    <span className="hint">
                      batch {h.batch_ids.map((b) => b ?? '—').join(', ')}
                      {h.batches_differ ? ' · batches differ' : ''}
                      {h.components > 1 ? ` · ${h.components} components` : ''}
                    </span>
                    {h.name ? <br /> : null}
                    {h.name && <span className="hint">{h.name}</span>}
                  </td>
                  <td>{h.program_code}</td>
                  <td>{h.similarity !== null ? h.similarity.toFixed(3) : h.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ margin: 0 }}>
            {r.provenance.method} · RDKit {r.provenance.rdkit_version}
            {r.no_structure > 0 && ` · ${r.no_structure} compounds have no structure`}
            {r.invalid_structures.length > 0 &&
              ` · registered SMILES RDKit cannot read: ${r.invalid_structures
                .map((x) => `${x.program_code} ${x.compound_id} batch ${x.batch_id ?? '—'} (${x.reason})`)
                .join('; ')}`}
          </p>
        </>
      )}
    </main>
  );
}
