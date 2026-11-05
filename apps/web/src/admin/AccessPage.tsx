import type { GroupMapping } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { ScimPanel } from './ScimPanel.tsx';

const ROLES: GroupMapping['role'][] = ['viewer', 'contributor', 'approver', 'admin', 'system_admin'];

export function AccessPage() {
  return (
    <RequireAuth>
      <main className="stack">
        <h1>Access</h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          Roles come from your identity provider's groups. Each mapping gives the members of an IdP group a
          role in the listed programs (codes, or * for all). Changes, including removals, apply on each user's
          next request.
        </p>
        <Mappings />
        <ScimPanel />
      </main>
    </RequireAuth>
  );
}

function MappingTable({
  label,
  items,
  onRemove,
}: {
  label: string;
  items: GroupMapping[];
  onRemove?: (i: number) => void;
}) {
  return (
    <table className="data" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">IdP group</th>
          <th scope="col">Role</th>
          <th scope="col">Programs</th>
          {onRemove && (
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {items.map((m, i) => (
          <tr key={`${m.group}-${m.role}-${i}`}>
            <th scope="row">{m.group}</th>
            <td>{m.role.replace('_', ' ')}</td>
            <td>{m.role === 'system_admin' ? 'all (global role)' : m.programs.join(', ') || '—'}</td>
            {onRemove && (
              <td>
                <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${m.group}`}>
                  Remove
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Mappings() {
  const client = useQueryClient();
  const data = useQuery({ queryKey: ['group-mappings'], queryFn: () => api('getGroupMappings') });
  const [items, setItems] = useState<GroupMapping[] | null>(null);
  const [draft, setDraft] = useState<{ group: string; role: GroupMapping['role']; programs: string }>({
    group: '',
    role: 'viewer',
    programs: '',
  });
  const current = items ?? data.data?.items ?? [];
  const save = useMutation({
    mutationFn: () => api('putGroupMappings', { body: { items: current }, reason: 'IdP group mappings' }),
    onSuccess: async (saved) => {
      setItems(saved.items);
      await client.invalidateQueries({ queryKey: ['group-mappings'] });
    },
  });
  return (
    <section className="card stack" aria-label="Group mappings">
      <h2 style={{ margin: 0 }}>Group mappings</h2>
      <ErrorMessage error={data.error} />
      <MappingTable
        label="Mappings"
        items={current}
        onRemove={(i) => setItems(current.filter((_, j) => j !== i))}
      />
      <div className="row">
        <Field label="IdP group">
          {(id) => (
            <input
              id={id}
              value={draft.group}
              onChange={(e) => setDraft((d) => ({ ...d, group: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Role">
          {(id) => (
            <select
              id={id}
              value={draft.role}
              onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as GroupMapping['role'] }))}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Programs" hint="Codes separated by commas, or *">
          {(id) => (
            <input
              id={id}
              value={draft.programs}
              onChange={(e) => setDraft((d) => ({ ...d, programs: e.target.value }))}
            />
          )}
        </Field>
        <button
          type="button"
          disabled={!draft.group.trim()}
          onClick={() => {
            const programs = draft.programs
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean);
            setItems([...current, { group: draft.group.trim(), role: draft.role, programs }]);
            setDraft({ group: '', role: 'viewer', programs: '' });
          }}
        >
          Add mapping
        </button>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          Save mappings
        </button>
        {save.isSuccess && <span role="status">Saved</span>}
      </div>
      <ErrorMessage error={save.error} />
      {(data.data?.from_config.length ?? 0) > 0 && (
        <>
          <h3 style={{ margin: '8px 0 0' }}>From the deployment configuration (read-only)</h3>
          <MappingTable label="From deployment configuration" items={data.data!.from_config} />
        </>
      )}
    </section>
  );
}
