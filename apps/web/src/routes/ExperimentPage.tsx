import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import type { ExperimentDetail, VersionDetail } from '@tributary/contracts';
import { useState } from 'react';
import { api } from '../api.ts';
import { useMe } from '../auth.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ASSAY_LABELS, Dialog, ErrorMessage, Field, Tabs, VersionStatus } from '../components/ui.tsx';
import { useCloneVersion, useExperiment, useRegistryInvalidation, useVersion } from '../registry/queries.ts';
import { ManifestEditor } from '../manifest/ManifestEditor.tsx';
import { FilesTab } from '../files/FilesTab.tsx';
import { canApproveIn, LaunchDialog } from '../pipelines/LaunchDialog.tsx';
import { ContrastsTab } from '../registry/ContrastsTab.tsx';
import { VersionsTab } from '../registry/VersionsTab.tsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'samples', label: 'Samples' },
  { id: 'contrasts', label: 'Contrasts' },
  { id: 'files', label: 'Files' },
  { id: 'versions', label: 'Versions' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ExperimentPage() {
  return (
    <RequireAuth>
      <ExperimentView />
    </RequireAuth>
  );
}

function ExperimentView() {
  const { id } = useParams({ from: '/experiments/$id' });
  const search = useSearch({ from: '/experiments/$id' });
  const navigate = useNavigate({ from: '/experiments/$id' });
  const experiment = useExperiment(id);
  const versionId = search.version ?? experiment.data?.versions.at(-1)?.id;
  const version = useVersion(versionId);
  const [tab, setTab] = useState<TabId>('overview');

  if (experiment.error || version.error)
    return (
      <main>
        <ErrorMessage error={experiment.error ?? version.error} />
      </main>
    );
  if (!experiment.data || !version.data) return <main>Loading…</main>;
  return (
    <main>
      <p>
        <Link to="/experiments">← Experiment list</Link>
      </p>
      <h1>{experiment.data.name}</h1>
      <div className="row" style={{ alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Version {version.data.version_number}</h2>
        <VersionStatus status={version.data.status} />
        <Field label="Version">
          {(fid) => (
            <select
              id={fid}
              value={version.data.id}
              onChange={(e) => void navigate({ search: { version: e.target.value } })}
            >
              {experiment.data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_number} ({v.status})
                </option>
              ))}
            </select>
          )}
        </Field>
        <VersionActions
          experiment={experiment.data}
          version={version.data}
          onVersion={(v) => void navigate({ search: { version: v } })}
        />
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'overview' && <Overview experiment={experiment.data} version={version.data} />}
        {tab === 'samples' && (
          <ManifestEditor
            key={version.data.id}
            version={version.data}
            readOnly={version.data.status !== 'draft'}
          />
        )}
        {tab === 'contrasts' && (
          <ContrastsTab
            key={version.data.id}
            version={version.data}
            canEdit={version.data.status === 'draft'}
          />
        )}
        {tab === 'files' && (
          <FilesTab key={version.data.id} version={version.data} programId={experiment.data.program_id} />
        )}
        {tab === 'versions' && <VersionsTab experiment={experiment.data} currentId={version.data.id} />}
      </div>
    </main>
  );
}

function VersionActions({
  experiment,
  version,
  onVersion,
}: {
  experiment: ExperimentDetail;
  version: VersionDetail;
  onVersion: (id: string) => void;
}) {
  const me = useMe();
  const invalidate = useRegistryInvalidation();
  const clone = useCloneVersion();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const publish = useMutation({
    mutationFn: () => api('publishVersion', { params: { id: version.id }, body: { reason } }),
    onSuccess: async () => {
      setOpen(false);
      setReason('');
      await invalidate();
    },
  });
  const role = me.data?.roles.find(
    (r) => r.program_id === experiment.program_id || r.role === 'system_admin',
  )?.role;
  const canWrite = role !== undefined && role !== 'viewer';
  const [launching, setLaunching] = useState(false);
  const navigateTo = useNavigate();

  return (
    <div className="row" style={{ marginLeft: 'auto' }}>
      {version.status === 'published' && canWrite && (
        <button type="button" className="primary" onClick={() => setLaunching(true)}>
          Launch pipeline
        </button>
      )}
      {launching && (
        <LaunchDialog
          target={{
            versionId: version.id,
            programId: experiment.program_id,
            assayType: experiment.assay_type,
          }}
          canApprove={canApproveIn(me.data?.roles, experiment.program_id)}
          onClose={() => setLaunching(false)}
          onLaunched={(id) => void navigateTo({ to: '/runs/$id', params: { id } })}
        />
      )}
      {version.status === 'draft' && canWrite && (
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          Publish
        </button>
      )}
      {canWrite && (
        <button
          type="button"
          disabled={clone.isPending}
          onClick={() => clone.mutate(version.id, { onSuccess: (v) => onVersion(v.id) })}
        >
          Create version
        </button>
      )}
      <ErrorMessage error={clone.error} />
      <Dialog title={`Publish version ${version.version_number}`} open={open} onClose={() => setOpen(false)}>
        <div className="stack">
          <p className="muted">
            Published versions are immutable. The manifest is validated against template{' '}
            {version.template_version}.
          </p>
          <Field label="Reason" hint="Recorded in the audit log">
            {(id) => <textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <ErrorMessage error={publish.error} />
          <div className="toolbar">
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={!reason.trim() || publish.isPending}
              onClick={() => publish.mutate()}
            >
              Publish version
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function Overview({ experiment, version }: { experiment: ExperimentDetail; version: VersionDetail }) {
  return (
    <dl className="details">
      <dt>URN</dt>
      <dd>
        <code>{version.urn}</code>
      </dd>
      <dt>Program</dt>
      <dd>{experiment.program_code}</dd>
      <dt>Assay type</dt>
      <dd>{ASSAY_LABELS[experiment.assay_type]}</dd>
      <dt>Experiment date</dt>
      <dd>{version.experiment_date ?? '—'}</dd>
      <dt>Species</dt>
      <dd>{version.species?.label ?? '—'}</dd>
      <dt>Spectral library</dt>
      <dd>{version.spectral_library ?? '—'}</dd>
      <dt>Time points</dt>
      <dd>{version.time_points.map((t) => `${t.value} ${t.unit}`).join(', ') || '—'}</dd>
      <dt>Template</dt>
      <dd>{version.template_version}</dd>
      <dt>Samples</dt>
      <dd>{version.sample_count}</dd>
      <dt>Description</dt>
      <dd>{version.description || '—'}</dd>
      {version.custom_fields
        .filter((f) => f.scope === 'experiment')
        .map((f) => (
          <div key={f.key} style={{ display: 'contents' }}>
            <dt>
              {f.label}
              {f.searchable ? ' (searchable)' : ''}
            </dt>
            <dd>{String(version.custom[f.key] ?? '—')}</dd>
          </div>
        ))}
      {version.publish_reason && (
        <>
          <dt>Publish reason</dt>
          <dd>{version.publish_reason}</dd>
        </>
      )}
    </dl>
  );
}
