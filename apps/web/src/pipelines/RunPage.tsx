import type { RunDetail } from '@tributary/contracts';
import { StatusBadge } from '@tributary/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { useMe } from '../auth.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { Dialog, ErrorMessage } from '../components/ui.tsx';
import { isActive, RUN_LABEL, RUN_TONE } from './labels.ts';
import { canApproveIn, LaunchDialog } from './LaunchDialog.tsx';

export function RunPage() {
  return (
    <RequireAuth>
      <Run />
    </RequireAuth>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function Run() {
  const { id } = useParams({ from: '/runs/$id' });
  const run = useQuery({
    queryKey: ['run', id],
    queryFn: () => api('getRun', { params: { id } }),
    // Poll while the run is active, and after success until its outputs are imported.
    refetchInterval: (q) => {
      const d = q.state.data;
      return !d || isActive(d.status) || (d.status === 'succeeded' && d.outputs.length === 0) ? 2000 : false;
    },
  });
  if (run.error)
    return (
      <main>
        <ErrorMessage error={run.error} />
      </main>
    );
  const r = run.data;
  if (!r) return <main>Loading…</main>;
  return (
    <main className="stack">
      <h1>
        {r.pipeline_name} · run {r.id.slice(0, 8)}
      </h1>
      <RunHeader run={r} />
      <section className="stack">
        <h2>Parameters</h2>
        <table className="data" aria-label="Parameters">
          <tbody>
            {Object.entries(r.params).map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>
                  <code>{String(v)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section role="region" aria-label="Timeline" className="stack">
        <h2>Timeline</h2>
        <ol>
          {r.events.map((e, i) => (
            <li key={i} style={{ opacity: e.applied ? 1 : 0.6 }}>
              {when(e.at)} — <strong>{RUN_LABEL[e.status]}</strong> ({e.external_status}, {e.source})
              {e.reason ? `: ${e.reason}` : ''}
              {e.applied ? '' : ' — recorded, not applied (older or after a final state)'}
            </li>
          ))}
        </ol>
      </section>
      <Logs id={r.id} active={isActive(r.status)} />
      <section className="stack">
        <h2>Outputs</h2>
        <table className="data" aria-label="Outputs">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Ingest</th>
              <th scope="col">Release</th>
            </tr>
          </thead>
          <tbody>
            {r.outputs.map((o) => (
              <tr key={o.file_id}>
                <th scope="row">{o.name}</th>
                <td>{o.ingest_status}</td>
                <td>
                  {o.release_id ? (
                    <Link to="/releases/$id" params={{ id: o.release_id }}>
                      {o.release_status}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {!r.outputs.length && (
              <tr>
                <td colSpan={3}>
                  {r.status === 'succeeded' ? 'Importing outputs…' : 'Outputs appear when the run succeeds.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function RunHeader({ run: r }: { run: RunDetail }) {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [rerun, setRerun] = useState(false);
  const version = useQuery({
    queryKey: ['version', r.experiment_version_id],
    queryFn: () => api('getVersion', { params: { id: r.experiment_version_id } }),
  });
  const cancel = useMutation({
    mutationFn: () => api('cancelRun', { params: { id: r.id }, reason: 'Cancelled from the run page' }),
    onSuccess: async () => {
      setConfirm(false);
      await queryClient.invalidateQueries({ queryKey: ['run', r.id] });
    },
  });
  const programId = version.data?.program_id;
  const role = me.data?.roles.find((b) => b.program_id === programId || b.role === 'system_admin')?.role;
  const canWrite = role !== undefined && role !== 'viewer';
  return (
    <section role="region" aria-label="Run" className="card stack">
      <div className="row" style={{ alignItems: 'center' }}>
        <StatusBadge label={RUN_LABEL[r.status]} tone={RUN_TONE[r.status]} />
        <span>
          {r.runner} · {r.external_id ?? 'not started'}
        </span>
        {version.data && (
          <Link
            to="/experiments/$id"
            params={{ id: version.data.experiment_id }}
            search={{ version: version.data.id }}
          >
            {version.data.experiment_name} v{version.data.version_number}
          </Link>
        )}
        <span className="hint">
          Started {when(r.started_at)} · finished {when(r.finished_at)}
        </span>
        <div className="row" style={{ marginLeft: 'auto' }}>
          {canWrite && isActive(r.status) && (
            <button type="button" onClick={() => setConfirm(true)}>
              Cancel run
            </button>
          )}
          {canWrite && version.data && (
            <button type="button" onClick={() => setRerun(true)}>
              Re-run with edits
            </button>
          )}
        </div>
      </div>
      {r.status_reason && <p style={{ margin: 0 }}>{r.status_reason}</p>}
      {r.log_links.length > 0 && (
        <p style={{ margin: 0 }}>
          Logs:{' '}
          {r.log_links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ marginRight: 12 }}>
              {l.label}
            </a>
          ))}
        </p>
      )}
      <Dialog title="Cancel run" open={confirm} onClose={() => setConfirm(false)}>
        <p>The runner is asked to stop; the status changes when it confirms.</p>
        <ErrorMessage error={cancel.error} />
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel run
          </button>
          <button type="button" onClick={() => setConfirm(false)}>
            Keep running
          </button>
        </div>
      </Dialog>
      {rerun && version.data && (
        <LaunchDialog
          target={{
            versionId: version.data.id,
            programId: version.data.program_id,
            assayType: version.data.assay_type,
          }}
          canApprove={canApproveIn(me.data?.roles, version.data.program_id)}
          initial={{ pipelineId: r.pipeline_definition_id, runner: r.runner, params: r.params }}
          onClose={() => setRerun(false)}
          onLaunched={(id) => {
            setRerun(false);
            void navigate({ to: '/runs/$id', params: { id } });
          }}
        />
      )}
    </section>
  );
}

function Logs({ id, active }: { id: string; active: boolean }) {
  const logs = useQuery({
    queryKey: ['run-logs', id],
    queryFn: () => api('getRunLogs', { params: { id } }),
    refetchInterval: active ? 3000 : false,
  });
  return (
    <section role="region" aria-label="Recent log lines" className="stack">
      <h2>Recent log lines</h2>
      <ErrorMessage error={logs.error} />
      <pre style={{ maxHeight: 320, overflow: 'auto', background: 'var(--surface-alt)', padding: 12 }}>
        {logs.data?.lines.join('\n') || 'No log lines yet.'}
      </pre>
    </section>
  );
}
