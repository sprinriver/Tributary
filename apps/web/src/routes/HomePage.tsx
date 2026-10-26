import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@tributary/ui';
import { describeHealth, fetchApiHealth } from '../health.ts';

export function HomePage() {
  const query = useQuery({ queryKey: ['api-health'], queryFn: () => fetchApiHealth(), retry: 1 });
  const { label, tone } = describeHealth(
    query.isPending
      ? { state: 'pending' }
      : query.isError
        ? { state: 'error' }
        : { state: 'success', health: query.data },
  );

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>Tributary</h1>
      <p>Experiment data platform for drug discovery.</p>
      <section aria-label="Service health">
        <StatusBadge label={label} tone={tone} />
      </section>
    </main>
  );
}
