import { RequireAuth } from '../components/Layout.tsx';

export function ExperimentsPage() {
  return (
    <RequireAuth>
      <main style={{ padding: 24 }}>
        <h1>Experiments</h1>
        <p>The experiment registry arrives in Phase 5.</p>
      </main>
    </RequireAuth>
  );
}
