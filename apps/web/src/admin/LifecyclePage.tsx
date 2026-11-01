import { StorageClassSchema, type LifecyclePolicy } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage, Field } from '../components/ui.tsx';

export function LifecyclePage() {
  return (
    <RequireAuth>
      <Lifecycle />
    </RequireAuth>
  );
}

const num = (v: string) => (v.trim() ? Number(v) : null);

/** Storage lifecycle per file role (SPEC M3/M11): when objects move to a cheaper class and when they expire. */
function Lifecycle() {
  const client = useQueryClient();
  const data = useQuery({ queryKey: ['lifecycle'], queryFn: () => api('getLifecyclePolicies') });
  const [items, setItems] = useState<LifecyclePolicy[] | null>(null);
  const current = items ?? data.data?.items ?? [];
  const set = (role: string, patch: Partial<LifecyclePolicy>) =>
    setItems(current.map((p) => (p.role === role ? { ...p, ...patch } : p)));
  const save = useMutation({
    mutationFn: () => api('putLifecyclePolicies', { body: { items: current }, reason: 'Lifecycle policies' }),
    onSuccess: async (saved) => {
      setItems(saved.items);
      await client.invalidateQueries({ queryKey: ['lifecycle'] });
    },
  });
  return (
    <main className="stack">
      <h1>Storage lifecycle</h1>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        New uploads are tagged with their role's policy; the bucket rules below are applied by the
        infrastructure deployment. Leave a field empty to keep objects in their class or forever.
      </p>
      <ErrorMessage error={data.error} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {current.map((p) => (
          <fieldset key={p.role} className="card stack" aria-label={`${p.role} files`}>
            <legend>{p.role} files</legend>
            <Field label="Move after (days)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  value={p.transition_days ?? ''}
                  onChange={(e) => set(p.role, { transition_days: num(e.target.value) })}
                />
              )}
            </Field>
            <Field label="Storage class">
              {(id) => (
                <select
                  id={id}
                  value={p.storage_class ?? ''}
                  onChange={(e) =>
                    set(p.role, {
                      storage_class: (e.target.value || null) as LifecyclePolicy['storage_class'],
                    })
                  }
                >
                  <option value="">Keep in standard storage</option>
                  {StorageClassSchema.options.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Delete after (days)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  value={p.expiration_days ?? ''}
                  onChange={(e) => set(p.role, { expiration_days: num(e.target.value) })}
                />
              )}
            </Field>
          </fieldset>
        ))}
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className="primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || !current.length}
        >
          Save policies
        </button>
        {save.isSuccess && <span role="status">Saved</span>}
      </div>
      <ErrorMessage error={save.error} />
      {data.data && (
        <details>
          <summary>S3 lifecycle rules generated from these policies</summary>
          <pre style={{ background: 'var(--surface-2)', padding: 12, borderRadius: 8, overflow: 'auto' }}>
            {JSON.stringify(data.data.s3_rules, null, 2)}
          </pre>
        </details>
      )}
    </main>
  );
}
