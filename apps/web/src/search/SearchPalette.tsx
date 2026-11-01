import type { SearchHit } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Snippet } from './SearchPage.tsx';

/** Waits until typing pauses before searching. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Global ⌘K / Ctrl+K search (SPEC M9): type, move with the arrow keys, Enter opens, Escape closes. */
export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const debounced = useDebounced(q.trim(), 150);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('tributary:search', onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('tributary:search', onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const results = useQuery({
    queryKey: ['search-palette', debounced],
    queryFn: () => api('search', { query: { q: debounced, limit: 30 } }),
    enabled: open && debounced.length > 0,
  });
  // Experiments first; a few samples, so one experiment's samples do not crowd out the rest.
  const all = results.data?.items ?? [];
  const items = [
    ...all.filter((h) => h.type === 'experiment').slice(0, 5),
    ...all.filter((h) => h.type === 'sample').slice(0, 3),
  ];

  const close = () => {
    setOpen(false);
    setActive(0);
  };
  const go = (hit: SearchHit | undefined) => {
    close();
    if (hit) void navigate({ to: '/experiments/$id', params: { id: hit.experiment_id } });
    else if (q.trim()) void navigate({ to: '/search', search: { q: q.trim() } });
  };

  if (!open) return null;
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.35)', zIndex: 50 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="card stack"
        style={{ maxWidth: 640, margin: '10vh auto 0', background: 'var(--surface)', padding: 16 }}
      >
        <input
          ref={input}
          role="combobox"
          aria-label="Search experiments and samples"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          placeholder="Search experiments and samples…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(items[active]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
          style={{ width: '100%', fontSize: 16, padding: 8 }}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Results"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {items.map((hit, i) => (
            <li
              key={`${hit.type}-${hit.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Samples are named by their key; the experiment title belongs to the experiment's own option.
              {...(hit.type === 'sample' ? { 'aria-label': `Sample ${hit.title}, ${hit.program_code}` } : {})}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(hit);
              }}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                background: i === active ? 'var(--brand-50)' : undefined,
              }}
            >
              <strong>{hit.title}</strong>{' '}
              <small style={{ color: 'var(--muted)' }}>
                {hit.type === 'sample' ? `Sample in ${hit.subtitle}` : `Experiment · ${hit.subtitle}`}
              </small>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                <Snippet text={hit.snippet} />
              </div>
            </li>
          ))}
        </ul>
        {debounced && results.isSuccess && !items.length && <p style={{ margin: 0 }}>No matches.</p>}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          ↑↓ to move · Enter to open · Esc to close
          {q.trim() && (
            <>
              {' · '}
              <a
                href={`/search?q=${encodeURIComponent(q.trim())}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(undefined);
                }}
              >
                All results for “{q.trim()}”
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
