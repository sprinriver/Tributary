import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { Dialog, ErrorMessage, Field } from '../components/ui.tsx';

interface ProgramRow {
  id: string;
  code: string;
  name: string;
  description: string;
  requires_approval: boolean;
}

export function ProgramsPage() {
  return (
    <RequireAuth>
      <Programs />
    </RequireAuth>
  );
}

/** Programs (SPEC M11): every experiment, dataset and role belongs to one. */
function Programs() {
  const client = useQueryClient();
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });
  const [draft, setDraft] = useState({ code: '', name: '', description: '', requires_approval: false });
  const [editing, setEditing] = useState<ProgramRow | null>(null);
  const create = useMutation({
    mutationFn: () => api('createProgram', { body: draft, reason: `New program ${draft.code}` }),
    onSuccess: async () => {
      setDraft({ code: '', name: '', description: '', requires_approval: false });
      await client.invalidateQueries({ queryKey: ['programs'] });
    },
  });
  return (
    <main className="stack">
      <h1>Programs</h1>
      <ErrorMessage error={programs.error} />
      <table className="data" aria-label="Programs">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Name</th>
            <th scope="col">Description</th>
            <th scope="col">Publishing</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {(programs.data?.items ?? []).map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.code}</th>
              <td>{p.name}</td>
              <td>{p.description || '—'}</td>
              <td>{p.requires_approval ? 'Approval required' : 'Contributors publish'}</td>
              <td>
                <button type="button" onClick={() => setEditing(p)}>
                  Edit<span className="sr-only"> {p.code}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="card stack" aria-label="New program">
        <h2 style={{ margin: 0 }}>New program</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Code" hint="Upper case, e.g. ONC">
            {(id) => (
              <input
                id={id}
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                required
              />
            )}
          </Field>
          <Field label="Name">
            {(id) => (
              <input
                id={id}
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                required
              />
            )}
          </Field>
          <Field label="Description">
            {(id) => (
              <input
                id={id}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            )}
          </Field>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={draft.requires_approval}
              onChange={(e) => setDraft((d) => ({ ...d, requires_approval: e.target.checked }))}
            />
            Requires approval to publish
          </label>
          <button type="submit" className="primary" disabled={create.isPending}>
            Create program
          </button>
        </form>
        <ErrorMessage error={create.error} />
      </section>
      {editing && <EditProgram program={editing} onClose={() => setEditing(null)} />}
    </main>
  );
}

function EditProgram({ program, onClose }: { program: ProgramRow; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({
    name: program.name,
    description: program.description,
    requires_approval: program.requires_approval,
  });
  const save = useMutation({
    mutationFn: () =>
      api('updateProgram', {
        params: { id: program.id },
        body: form,
        reason: `Edit program ${program.code}`,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['programs'] });
      onClose();
    },
  });
  return (
    <Dialog title={`Edit ${program.code}`} open onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          {(id) => (
            <input
              id={id}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          )}
        </Field>
        <Field label="Description">
          {(id) => (
            <input
              id={id}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          )}
        </Field>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={form.requires_approval}
            onChange={(e) => setForm((f) => ({ ...f, requires_approval: e.target.checked }))}
          />
          Requires approval to publish
        </label>
        <ErrorMessage error={save.error} />
        <div className="toolbar">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
