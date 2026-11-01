import { SEARCH_FACETS, type SearchFacet, type SearchHit, type SearchResponse } from '@tributary/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage } from '../components/ui.tsx';
import { joinList, snippetParts, splitList } from './snippet.ts';

export interface SearchPageSearch {
  q?: string | undefined;
  type?: 'experiment' | 'sample' | undefined;
  assay_type?: string | undefined;
  program_id?: string | undefined;
  species?: string | undefined;
  compound?: string | undefined;
  status?: string | undefined;
}

/** URL key of each facet (comma-separated values). */
export const FACET_PARAM = {
  assay_type: 'assay_type',
  program: 'program_id',
  species: 'species',
  compound: 'compound',
  status: 'status',
} as const satisfies Record<SearchFacet, keyof SearchPageSearch>;

const FACET_LABEL: Record<SearchFacet, string> = {
  assay_type: 'Assay type',
  program: 'Program',
  species: 'Species',
  compound: 'Compound',
  status: 'Status',
};

export function Snippet({ text }: { text: string }) {
  return (
    <>
      {snippetParts(text).map((p, i) =>
        p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}

/** The query box; remounted (key) when the URL query changes, so it starts from the URL's value. */
function SearchForm({
  q,
  type,
  set,
}: {
  q: string;
  type: SearchPageSearch['type'];
  set: (patch: Partial<SearchPageSearch>) => void;
}) {
  const [draft, setDraft] = useState(q);
  return (
    <form
      role="search"
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        set({ q: draft.trim() || undefined });
      }}
    >
      <input
        type="search"
        aria-label="Search"
        placeholder="What are you looking for? (cell line, compound, assay, sample…)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ flex: 1, minWidth: 280 }}
      />
      <select
        aria-label="Type"
        value={type ?? ''}
        onChange={(e) => set({ type: (e.target.value || undefined) as SearchPageSearch['type'] })}
      >
        <option value="">Experiments and samples</option>
        <option value="experiment">Experiments</option>
        <option value="sample">Samples</option>
      </select>
      <button type="submit">Search</button>
    </form>
  );
}

/**
 * Hits grouped by experiment, in order of each experiment's best hit: one link per experiment, its matching
 * samples listed under it (samples open on their experiment's page), so one experiment's samples cannot crowd
 * out the others.
 */
export function groupByExperiment(hits: SearchHit[]) {
  const groups = new Map<
    string,
    { experiment_id: string; experiment_name: string; experiment?: SearchHit; samples: SearchHit[] }
  >();
  for (const hit of hits) {
    const g = groups.get(hit.experiment_id) ?? {
      experiment_id: hit.experiment_id,
      experiment_name: hit.experiment_name,
      samples: [],
    };
    if (hit.type === 'experiment') g.experiment = hit;
    else g.samples.push(hit);
    groups.set(hit.experiment_id, g);
  }
  return [...groups.values()];
}

export function SearchPage() {
  return (
    <RequireAuth>
      <Search />
    </RequireAuth>
  );
}

function Search() {
  const search = useSearch({ from: '/search' });
  const navigate = useNavigate({ from: '/search' });
  const q = search.q?.trim() ?? '';
  const filters = Object.fromEntries(
    SEARCH_FACETS.map((f) => [FACET_PARAM[f], splitList(search[FACET_PARAM[f]])]),
  ) as Record<(typeof FACET_PARAM)[SearchFacet], string[]>;

  const results = useInfiniteQuery({
    queryKey: ['search', search],
    enabled: q.length > 0,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api('search', {
        query: {
          q,
          ...(search.type ? { type: search.type } : {}),
          ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length)),
          limit: 20,
          ...(pageParam ? { cursor: pageParam } : {}),
        },
      }),
    getNextPageParam: (last: SearchResponse) => last.next_cursor ?? undefined,
  });
  const first = results.data?.pages[0];
  const hits = results.data?.pages.flatMap((p) => p.items) ?? [];
  const set = (patch: Partial<SearchPageSearch>) => void navigate({ search: { ...search, ...patch } });
  const toggle = (f: SearchFacet, value: string, on: boolean) => {
    const current = filters[FACET_PARAM[f]];
    set({ [FACET_PARAM[f]]: joinList(on ? [...current, value] : current.filter((v) => v !== value)) });
  };

  return (
    <main className="stack">
      <h1>Search</h1>
      <SearchForm key={search.q ?? ''} q={search.q ?? ''} type={search.type} set={set} />
      <ErrorMessage error={results.error} />
      {first && first.expansions.length > 0 && (
        <p style={{ margin: 0, color: '#57606a' }}>
          Also searched:{' '}
          {first.expansions.map((e) => `${e.label} (for “${e.matched}”, ${e.term_id})`).join('; ')}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) 1fr', gap: 24 }}>
        <section aria-label="Filters" className="stack">
          {first &&
            SEARCH_FACETS.map((f) =>
              first.facets[f].length ? (
                <fieldset key={f} aria-label={FACET_LABEL[f]} style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend style={{ fontWeight: 600 }}>{FACET_LABEL[f]}</legend>
                  {first.facets[f].map((v) => (
                    <label key={v.value} style={{ display: 'block' }}>
                      <input
                        type="checkbox"
                        checked={filters[FACET_PARAM[f]].includes(v.value)}
                        onChange={(e) => toggle(f, v.value, e.target.checked)}
                      />{' '}
                      {v.label} ({v.count})
                    </label>
                  ))}
                </fieldset>
              ) : null,
            )}
        </section>
        <section aria-label="Search results" className="stack">
          {!q && (
            <p>Type a cell line, compound, assay or sample key. Press ⌘K (Ctrl+K) anywhere to search.</p>
          )}
          {first && (
            <p style={{ margin: 0, color: '#57606a' }}>
              {first.total}
              {first.capped ? '+' : ''} {first.total === 1 ? 'hit' : 'hits'} ·{' '}
              {first.mode === 'hybrid' ? 'full-text and semantic' : 'full-text'}
            </p>
          )}
          {first && !hits.length && <p>No experiments or samples match “{q}” in your programs.</p>}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack">
            {groupByExperiment(hits).map((g) => (
              <li key={g.experiment_id} className="card" style={{ padding: 12 }}>
                <div>
                  <small style={{ color: '#57606a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    experiment
                  </small>{' '}
                  <Link to="/experiments/$id" params={{ id: g.experiment_id }} style={{ fontWeight: 600 }}>
                    {g.experiment_name}
                  </Link>
                </div>
                {g.experiment && (
                  <>
                    <div style={{ color: '#57606a', fontSize: 13 }}>
                      {g.experiment.subtitle} · {g.experiment.status}
                    </div>
                    <div style={{ fontSize: 14 }}>
                      <Snippet text={g.experiment.snippet} />
                    </div>
                  </>
                )}
                {g.samples.length > 0 && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    <span style={{ color: '#57606a' }}>
                      {g.samples.length} matching {g.samples.length === 1 ? 'sample' : 'samples'}:
                    </span>{' '}
                    {g.samples.map((h) => h.title).join(', ')}
                    {!g.experiment && g.samples[0] && (
                      <div>
                        <Snippet text={g.samples[0].snippet} />
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {results.hasNextPage && (
            <button
              type="button"
              onClick={() => void results.fetchNextPage()}
              disabled={results.isFetchingNextPage}
            >
              Load more
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
