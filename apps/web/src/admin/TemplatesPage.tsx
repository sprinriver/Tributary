import {
  AssayTypeKeySchema,
  type AdminTemplate,
  type AssayTypeKey,
  type MetadataFieldDef,
  type TemplatePreview,
} from '@tributary/contracts';
import { StatusBadge } from '@tributary/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ASSAY_LABELS, Dialog, ErrorMessage, Field } from '../components/ui.tsx';
import { FieldEditor } from './FieldEditor.tsx';

const STATUS_TONE = { published: 'ok', draft: 'pending', retired: 'warning' } as const;
const STATUS_LABEL = { published: 'Published', draft: 'Draft', retired: 'Retired' } as const;

export function TemplatesPage() {
  return (
    <RequireAuth>
      <Templates />
    </RequireAuth>
  );
}

function Templates() {
  const [assay, setAssay] = useState<AssayTypeKey>('proteomics_dia');
  const [editing, setEditing] = useState(false);
  const [previewOf, setPreviewOf] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin-templates', assay],
    queryFn: () => api('listAdminTemplates', { query: { assay_type: assay } }),
  });
  const items = list.data?.items ?? [];
  const current = items.find((t) => t.status === 'published');

  return (
    <main className="stack">
      <h1>Metadata templates</h1>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        Each experiment version keeps the template version it was created with. Publishing a new version
        changes what new drafts must fill in; published versions stay valid under theirs.
      </p>
      <div className="row">
        <Field label="Assay type">
          {(id) => (
            <select
              id={id}
              value={assay}
              onChange={(e) => {
                setAssay(e.target.value as AssayTypeKey);
                setEditing(false);
                setPreviewOf(null);
              }}
            >
              {AssayTypeKeySchema.options.map((k) => (
                <option key={k} value={k}>
                  {ASSAY_LABELS[k] ?? k}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button
          type="button"
          className="primary"
          onClick={() => setEditing(true)}
          disabled={!current || editing}
        >
          New version
        </button>
      </div>
      <ErrorMessage error={list.error} />
      <table className="data" aria-label="Template versions">
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Status</th>
            <th scope="col">Fields</th>
            <th scope="col">Required</th>
            <th scope="col">Pinned by (draft · published · archived)</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.version}>
              <th scope="row">
                {t.version}
                {t.built_in && <small style={{ color: 'var(--muted)' }}> (built-in)</small>}
              </th>
              <td>
                <StatusBadge label={STATUS_LABEL[t.status]} tone={STATUS_TONE[t.status]} live={false} />
              </td>
              <td>{t.fields.length}</td>
              <td>{t.fields.filter((f) => f.required).length}</td>
              <td>
                {t.pinned.draft} · {t.pinned.published} · {t.pinned.archived}
              </td>
              <td>
                {t.status === 'draft' && (
                  <button type="button" onClick={() => setPreviewOf(t.version)}>
                    Preview
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && current && (
        <NewVersion
          base={current}
          onCancel={() => setEditing(false)}
          onCreated={(v) => {
            setEditing(false);
            setPreviewOf(v);
          }}
        />
      )}
      {previewOf && <Preview assay={assay} version={previewOf} onDone={() => setPreviewOf(null)} />}
    </main>
  );
}

function NewVersion({
  base,
  onCancel,
  onCreated,
}: {
  base: AdminTemplate;
  onCancel: () => void;
  onCreated: (version: string) => void;
}) {
  const client = useQueryClient();
  const [fields, setFields] = useState<MetadataFieldDef[]>(base.fields);
  const [bump, setBump] = useState<'major' | 'minor' | 'patch'>('minor');
  const create = useMutation({
    mutationFn: () =>
      api('createTemplate', {
        body: { assay_type: base.assay_type, bump, fields, key_field: base.key_field },
        reason: `New ${base.assay_type} template from ${base.version}`,
      }),
    onSuccess: async (created) => {
      await client.invalidateQueries({ queryKey: ['admin-templates', base.assay_type] });
      onCreated(created.version);
    },
  });
  return (
    <section className="card stack" aria-label="New template version">
      <h2 style={{ margin: 0 }}>New version of {base.version}</h2>
      <FieldEditor fields={fields} keyField={base.key_field} onChange={setFields} />
      <div className="row">
        <Field label="Version bump">
          {(id) => (
            <select id={id} value={bump} onChange={(e) => setBump(e.target.value as typeof bump)}>
              <option value="minor">Minor (new optional or required fields)</option>
              <option value="patch">Patch (labels and wording)</option>
              <option value="major">Major (removed or retyped fields)</option>
            </select>
          )}
        </Field>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => create.mutate()} disabled={create.isPending}>
          Create draft
        </button>
      </div>
      <ErrorMessage error={create.error} />
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <strong>{title}</strong>{' '}
      {items.length ? (
        items.map((k) => (
          <code key={k} style={{ marginRight: 6 }}>
            {k}
          </code>
        ))
      ) : (
        <span>none</span>
      )}
    </div>
  );
}

function Preview({ assay, version, onDone }: { assay: AssayTypeKey; version: string; onDone: () => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const preview = useQuery({
    queryKey: ['template-preview', assay, version],
    queryFn: () => api('previewTemplate', { params: { assay_type: assay, version } }),
  });
  const publish = useMutation({
    mutationFn: () => api('publishTemplate', { params: { assay_type: assay, version }, body: { reason } }),
    onSuccess: async () => {
      setOpen(false);
      await client.invalidateQueries({ queryKey: ['admin-templates', assay] });
      onDone();
    },
  });
  const p: TemplatePreview | undefined = preview.data;
  return (
    <section className="card stack" aria-label="Migration preview">
      <h2 style={{ margin: 0 }}>
        Migration preview: <span data-testid="new-version">{version}</span>
      </h2>
      <ErrorMessage error={preview.error} />
      {p && (
        <>
          <p style={{ margin: 0 }}>
            New drafts will pin <strong>{p.version}</strong> instead of <strong>{p.base_version}</strong>.
            Existing experiment versions keep the template they pinned:
            {p.pinned.length
              ? ` ${p.pinned.map((x) => `${x.version}: ${x.published} published, ${x.draft} draft`).join('; ')}.`
              : ' none yet.'}
          </p>
          <List title="Added:" items={p.added} />
          <List title="Newly required:" items={p.newly_required} />
          <List title="Changed:" items={p.changed} />
          <List title="Removed:" items={p.removed} />
          <div className="toolbar">
            <button type="button" className="primary" onClick={() => setOpen(true)}>
              Publish version
            </button>
          </div>
        </>
      )}
      <Dialog title={`Publish template ${version}`} open={open} onClose={() => setOpen(false)}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate();
          }}
        >
          <Field label="Reason">
            {(id) => <textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} required />}
          </Field>
          <ErrorMessage error={publish.error} />
          <div className="toolbar">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!reason.trim() || publish.isPending}>
              Publish
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
