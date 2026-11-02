import type { ReleaseDetail } from '@tributary/contracts';
import { StatusBadge } from '@tributary/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { useMe } from '../auth.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { Dialog, ErrorMessage, Field } from '../components/ui.tsx';
import { History } from '../trust/History.tsx';
import { RELEASE_TONE, releaseLabel, statValue } from './labels.ts';

export function ReleasePage() {
  return (
    <RequireAuth>
      <Release />
    </RequireAuth>
  );
}

function Release() {
  const { id } = useParams({ from: '/releases/$id' });
  const release = useQuery({
    queryKey: ['release', id],
    queryFn: () => api('getRelease', { params: { id } }),
  });
  if (release.error)
    return (
      <main>
        <ErrorMessage error={release.error} />
      </main>
    );
  const r = release.data;
  if (!r) return <main>Loading…</main>;
  return (
    <main className="stack">
      <p>
        <Link to="/datasets">← Dataset catalog</Link>
      </p>
      <h1>
        {r.dataset_name} · {r.kind}
      </h1>
      <ReleaseHeader release={r} />
      <p style={{ margin: 0 }}>
        <Link to="/lineage/$kind/$id" params={{ kind: 'dataset_release', id: r.id }}>
          Lineage
        </Link>
      </p>
      <section className="stack" role="region" aria-label="Quality rules">
        <h2>Quality rules</h2>
        {r.validation.failures.length > 0 && (
          <ul>
            {r.validation.failures.map((f) => (
              <li key={f.rule_id}>
                <strong>{f.rule_id}</strong> ({f.severity}): {f.message}{' '}
                <span className="hint">Source: {f.source}</span>
              </li>
            ))}
          </ul>
        )}
        <table className="data" aria-label="Contract rules">
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">Columns</th>
              <th scope="col">Severity</th>
              <th scope="col">Source</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {r.contract.qualityRules.map((rule) => {
              const failure = r.validation.failures.find((f) => f.rule_id === rule.id);
              return (
                <tr key={rule.id}>
                  <th scope="row">{rule.id}</th>
                  <td>{rule.columns.join(', ')}</td>
                  <td>{rule.severity}</td>
                  <td>{rule.source}</td>
                  <td>{failure ? `${failure.failing_rows} row(s) fail` : 'Passed'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="stack">
        <h2>Schema</h2>
        <p className="hint">
          Contract {r.kind} {r.contract_version}.{' '}
          <a href={`/api/v1/contracts/${r.kind}/odcs`} download>
            Download ODCS contract (YAML)
          </a>
        </p>
        <table className="data" aria-label="Schema">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Type</th>
              <th scope="col">Required</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {r.contract.columns.map((c) => (
              <tr key={c.name}>
                <th scope="row">{c.name}</th>
                <td>
                  {c.type}
                  {c.unit ? ` (${c.unit})` : ''}
                </td>
                <td>{c.nullable ? 'no' : 'yes'}</td>
                <td>{c.description ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="stack">
        <h2>Column statistics</h2>
        <table className="data" aria-label="Column statistics">
          <thead>
            <tr>
              <th scope="col">Column</th>
              <th scope="col">Empty</th>
              <th scope="col">Distinct</th>
              <th scope="col">Min</th>
              <th scope="col">Max</th>
            </tr>
          </thead>
          <tbody>
            {r.contract.columns
              .filter((c) => r.column_stats[c.name])
              .map((c) => [c.name, r.column_stats[c.name]!] as const)
              .map(([name, s]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{s.null_count.toLocaleString()}</td>
                  <td>{s.distinct_count.toLocaleString()}</td>
                  <td>{statValue(s.min)}</td>
                  <td>{statValue(s.max)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
      <Provenance release={r} />
      {r.storage && <Preview id={r.id} />}
      <History type="dataset_release" id={r.id} />
    </main>
  );
}

function ReleaseHeader({ release: r }: { release: ReleaseDetail }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const publish = useMutation({
    mutationFn: () => api('publishRelease', { params: { id: r.id }, body: { reason } }),
    onSuccess: async (data) => {
      queryClient.setQueryData(['release', r.id], data);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
    },
  });
  const role = me.data?.roles.find((b) => b.program_id === r.program_id || b.role === 'system_admin')?.role;
  const canPublish = r.status === 'staged' && role !== undefined && role !== 'viewer';
  return (
    <section role="region" aria-label="Release" className="card stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <strong>Release #{r.release_number}</strong>
        <StatusBadge label={releaseLabel(r.status)} tone={RELEASE_TONE[r.status] ?? 'pending'} />
        <span>{r.row_count.toLocaleString()} rows</span>
        <span>
          {r.program_code}
          {r.experiment_id && (
            <>
              {' · '}
              <Link to="/experiments/$id" params={{ id: r.experiment_id }}>
                {r.experiment_name}
              </Link>
            </>
          )}
        </span>
        {canPublish && (
          <button
            type="button"
            className="primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setOpen(true)}
          >
            Publish release
          </button>
        )}
      </div>
      {r.status_reason && <p style={{ margin: 0 }}>Reason: {r.status_reason}</p>}
      <Dialog title="Publish release" open={open} onClose={() => setOpen(false)}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            publish.mutate();
          }}
        >
          <p>Published releases are immutable and appear in the Explorer.</p>
          <Field label="Reason">
            {(id) => <textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <ErrorMessage error={publish.error} />
          <div className="row">
            <button
              type="submit"
              className="primary"
              disabled={reason.trim().length < 3 || publish.isPending}
            >
              Publish
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function Provenance({ release: r }: { release: ReleaseDetail }) {
  return (
    <section className="stack">
      <h2>Provenance</h2>
      <dl className="stack">
        <div>
          <dt>Importer</dt>
          <dd>
            {r.source.importer} {r.source.importer_version} · {r.source.tool} {r.source.tool_version}
          </dd>
        </div>
        <div>
          <dt>Input</dt>
          <dd>
            {r.lineage.inputs.map((i) => i.name).join(', ') || '—'}
            {r.source.file?.sha256 && (
              <span className="hint"> sha256 {r.source.file.sha256.slice(0, 12)}…</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Original columns</dt>
          <dd>
            {r.source.original_columns.slice(0, 12).join(', ')}
            {r.source.original_columns.length > 12 ? ', …' : ''}
          </dd>
        </div>
        <div>
          <dt>Transformations</dt>
          <dd>
            <ol>
              {r.transformations.map((t, i) => (
                <li key={i}>
                  <strong>{t.step}</strong>: {t.detail}
                </li>
              ))}
            </ol>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Preview({ id }: { id: string }) {
  const preview = useQuery({
    queryKey: ['release-preview', id],
    queryFn: () => api('previewRelease', { params: { id }, query: { limit: 10 } }),
  });
  const columns = preview.data?.rows[0] ? Object.keys(preview.data.rows[0]) : [];
  const show = (v: unknown) =>
    v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v);
  return (
    <section className="stack">
      <h2>First rows</h2>
      <ErrorMessage error={preview.error} />
      {/* Wide tables scroll sideways; the region takes focus so keyboard users can scroll it (WCAG 2.1.1). */}
      <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="First rows, scrollable">
        <table className="data" aria-label="First rows">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.data?.rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{show(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
