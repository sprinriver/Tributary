import type { ExperimentDetail, VersionDiff } from '@tributary/contracts';
import { useState } from 'react';
import { ErrorMessage, Field, VersionStatus } from '../components/ui.tsx';
import { useDiff } from './queries.ts';

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(show).join(', ');
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('label' in v) return String(v.label);
    if ('value' in v && 'unit' in v) return `${String(v.value)} ${String(v.unit)}`;
    return JSON.stringify(value);
  }
  return String(value);
};

export function VersionsTab({ experiment, currentId }: { experiment: ExperimentDetail; currentId: string }) {
  const versions = experiment.versions;
  const current = versions.find((v) => v.id === currentId);
  const previous = versions.find((v) => v.version_number === (current?.version_number ?? 1) - 1);
  const [from, setFrom] = useState(previous?.id ?? '');
  const [to, setTo] = useState(previous ? currentId : '');
  const diff = useDiff(from || undefined, to || undefined);

  return (
    <div className="stack">
      <table className="data" aria-label="Version history">
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            <th scope="col">Published</th>
            <th scope="col">Reason</th>
            <th scope="col">Latest published</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td>v{v.version_number}</td>
              <td>
                <VersionStatus status={v.status} live={false} />
              </td>
              <td>{new Date(v.created_at).toLocaleString()}</td>
              <td>{v.published_at ? new Date(v.published_at).toLocaleString() : '—'}</td>
              <td>{v.publish_reason ?? '—'}</td>
              <td>{v.is_latest_published ? 'Yes' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row">
        {(['from', 'to'] as const).map((side) => (
          <Field key={side} label={side === 'from' ? 'Compare from' : 'Compare to'}>
            {(id) => (
              <select
                id={id}
                value={side === 'from' ? from : to}
                onChange={(e) => (side === 'from' ? setFrom : setTo)(e.target.value)}
              >
                <option value="">Choose…</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version_number}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ))}
      </div>
      <ErrorMessage error={diff.error} />
      {diff.data && <DiffView diff={diff.data} />}
    </div>
  );
}

function DiffView({ diff }: { diff: VersionDiff }) {
  const { added, removed, changed } = diff.samples;
  return (
    <section role="region" aria-label="Differences" className="stack">
      <h2>Differences</h2>
      <table className="data" aria-label="Changed fields">
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {[...diff.fields, ...diff.custom.map((c) => ({ ...c, field: `custom.${c.field}` }))].map((c) => (
            <tr key={c.field}>
              <td>{c.field}</td>
              <td>{show(c.before)}</td>
              <td>{show(c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!diff.fields.length && !diff.custom.length && <p className="muted">No field changes.</p>}
      {(diff.custom_fields.added.length > 0 || diff.custom_fields.removed.length > 0) && (
        <p>
          Custom fields added: {diff.custom_fields.added.join(', ') || 'none'}; removed:{' '}
          {diff.custom_fields.removed.join(', ') || 'none'}
        </p>
      )}
      <p>
        {changed.length} {changed.length === 1 ? 'sample' : 'samples'} changed
      </p>
      {added.length || removed.length ? (
        <p>
          Added: {added.join(', ') || 'none'} · Removed: {removed.join(', ') || 'none'}
        </p>
      ) : (
        <p>No samples added or removed</p>
      )}
      {changed.length > 0 && (
        <table className="data" aria-label="Changed samples">
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col">Column</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {changed.flatMap((s) =>
              s.fields.map((f) => (
                <tr key={`${s.sample_key}-${f.field}`}>
                  <td>{s.sample_key}</td>
                  <td>{f.field}</td>
                  <td>{show(f.before)}</td>
                  <td>{show(f.after)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}
      {(diff.contrasts.added.length > 0 || diff.contrasts.removed.length > 0) && (
        <p>
          Contrasts added: {diff.contrasts.added.join(', ') || 'none'}; removed:{' '}
          {diff.contrasts.removed.join(', ') || 'none'}
        </p>
      )}
    </section>
  );
}
