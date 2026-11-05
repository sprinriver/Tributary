import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';

/** Watch / stop watching a protein, gene or compound (Phase 26, WAT-03). */
export function WatchButton({
  kind,
  itemKey,
  label,
}: {
  kind: 'protein' | 'gene' | 'compound';
  itemKey: string;
  label?: string;
}) {
  const client = useQueryClient();
  const watches = useQuery({ queryKey: ['watches'], queryFn: () => api('listWatches') });
  const current = watches.data?.items.find((w) => w.kind === kind && w.key === itemKey);
  const done = () => client.invalidateQueries({ queryKey: ['watches'] });
  const start = useMutation({
    mutationFn: () => api('createWatch', { body: { kind, key: itemKey, ...(label ? { label } : {}) } }),
    onSuccess: done,
  });
  const stop = useMutation({
    mutationFn: (id: string) => api('deleteWatch', { params: { id } }),
    onSuccess: done,
  });
  if (!watches.data) return null;
  return (
    <span>
      {current ? (
        <button
          type="button"
          aria-pressed="true"
          disabled={stop.isPending}
          onClick={() => stop.mutate(current.id)}
        >
          Watching ✓ — stop
        </button>
      ) : (
        <button type="button" aria-pressed="false" disabled={start.isPending} onClick={() => start.mutate()}>
          Watch {itemKey}
        </button>
      )}
      <ErrorMessage error={start.error ?? stop.error} />
    </span>
  );
}
