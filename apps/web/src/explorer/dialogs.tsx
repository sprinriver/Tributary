import type { QuerySpec } from '@tributary/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Field, Tabs } from '../components/ui.tsx';
import { pythonCode, rCode, specJson } from './codegen.ts';

export function SaveViewDialog({
  spec,
  onClose,
  onSaved,
}: {
  spec: QuerySpec;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const programs = useQuery({ queryKey: ['programs'], queryFn: () => api('listPrograms') });
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'program'>('private');
  const [programId, setProgramId] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api('createView', {
        body: {
          name,
          query_spec: spec,
          visibility,
          ...(visibility === 'program' ? { program_id: programId || programs.data?.items[0]?.id } : {}),
        },
        reason: 'Save view',
      }),
    onSuccess: (view) => onSaved(view.id),
  });
  return (
    <Dialog title="Save view" open onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}
        </Field>
        <Field
          label="Visibility"
          hint="Links open only for people who may see the view; the data stays scoped to their programs."
        >
          {(id) => (
            <select
              id={id}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'private' | 'program')}
            >
              <option value="private">Only me</option>
              <option value="program">Everyone in a program</option>
            </select>
          )}
        </Field>
        {visibility === 'program' && (
          <Field label="Program">
            {(id) => (
              <select id={id} value={programId} onChange={(e) => setProgramId(e.target.value)}>
                {programs.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <ErrorMessage error={save.error} />
        <div className="row">
          <button type="submit" className="primary" disabled={!name.trim() || save.isPending}>
            Save
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

type Lang = 'python' | 'r' | 'json';

export function CopyCodeDialog({ spec, onClose }: { spec: QuerySpec; onClose: () => void }) {
  const [lang, setLang] = useState<Lang>('python');
  const [copied, setCopied] = useState(false);
  const apiBase = `${window.location.origin}/api`;
  const { page: _page, ...portable } = spec;
  const code =
    lang === 'python'
      ? pythonCode(portable, apiBase)
      : lang === 'r'
        ? rCode(portable, apiBase)
        : specJson(portable);
  return (
    <Dialog title="Copy as code" open onClose={onClose}>
      <div className="stack" style={{ minWidth: 'min(720px, 90vw)' }}>
        <Tabs
          tabs={[
            { id: 'python', label: 'Python' },
            { id: 'r', label: 'R' },
            { id: 'json', label: 'QuerySpec JSON' },
          ]}
          value={lang}
          onChange={(l) => {
            setLang(l);
            setCopied(false);
          }}
        />
        <p className="hint" style={{ margin: 0 }}>
          Needs a personal access token in the{' '}
          <span style={{ fontFamily: 'monospace' }}>TRIBUTARY_TOKEN</span> environment variable (your menu →
          access tokens).
        </p>
        <div role="tabpanel" id={`panel-${lang}`} aria-labelledby={`tab-${lang}`}>
          <pre
            role="code"
            style={{ maxHeight: 420, overflow: 'auto', background: '#f6f8fa', padding: 12, margin: 0 }}
          >
            {code}
          </pre>
        </div>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => void navigator.clipboard.writeText(code).then(() => setCopied(true))}
          >
            Copy
          </button>
          {copied && <span role="status">Copied</span>}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
