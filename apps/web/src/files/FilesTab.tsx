import {
  FileRoleSchema,
  INGEST_IN_PROGRESS,
  type FileRole,
  type FileSummary,
  type VersionDetail,
} from '@tributary/contracts';
import { StatusBadge } from '@tributary/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { useMe } from '../auth.ts';
import { ErrorMessage, Field } from '../components/ui.tsx';
import { formatBytes, formatLabel, STATUS_LABEL, STATUS_TONE } from './labels.ts';
import { ImportDialog } from './ImportDialog.tsx';
import { QcGatePanel } from './QcGatePanel.tsx';
import { uploadFile } from './uploader.ts';

interface Upload {
  name: string;
  loaded: number;
  total: number;
  error?: string;
}

export function useVersionFiles(versionId: string, poll: boolean) {
  return useQuery({
    queryKey: ['files', versionId],
    queryFn: () => api('listVersionFiles', { params: { id: versionId } }),
    refetchInterval: poll ? 1500 : false,
  });
}

export function FilesTab({ version, programId }: { version: VersionDetail; programId: string }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const role = me.data?.roles.find((r) => r.program_id === programId || r.role === 'system_admin')?.role;
  const canWrite = version.status === 'draft' && role !== undefined && role !== 'viewer';
  const canApprove = me.data?.roles.some(
    (r) =>
      r.role === 'system_admin' ||
      (r.program_id === programId && (r.role === 'approver' || r.role === 'admin')),
  );

  const [chosen, setChosen] = useState<File[]>([]);
  const [fileRole, setFileRole] = useState<FileRole>('raw');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [importing, setImporting] = useState<FileSummary | null>(null);
  const canImport = role !== undefined && role !== 'viewer';
  const busy = uploads.some((u) => u.loaded < u.total && !u.error);
  const files = useVersionFiles(version.id, true);
  const inProgress = files.data?.items.some((f) => INGEST_IN_PROGRESS.includes(f.ingest_status)) ?? false;

  const upload = useMutation({
    mutationFn: async (list: File[]) => {
      setUploads(list.map((f) => ({ name: f.name, loaded: 0, total: f.size })));
      const update = (name: string, patch: Partial<Upload>) =>
        setUploads((all) => all.map((u) => (u.name === name ? { ...u, ...patch } : u)));
      await Promise.all(
        list.map(async (f) => {
          try {
            await uploadFile(f, {
              versionId: version.id,
              role: fileRole,
              onProgress: (loaded) => update(f.name, { loaded }),
            });
          } catch (error) {
            update(f.name, { error: (error as Error).message });
          }
          await queryClient.invalidateQueries({ queryKey: ['files', version.id] });
        }),
      );
    },
    onSettled: () => setChosen([]),
  });

  return (
    <section className="stack" aria-label="Files of this version">
      {canWrite && (
        <form
          className="row"
          style={{ alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            upload.mutate(chosen);
          }}
        >
          <Field
            label="Choose files"
            hint="Files go straight to object storage in parts; interrupted uploads resume."
          >
            {(id) => (
              <input
                id={id}
                type="file"
                multiple
                disabled={busy}
                onChange={(e) => setChosen([...(e.target.files ?? [])])}
              />
            )}
          </Field>
          <Field label="Role">
            {(id) => (
              <select id={id} value={fileRole} onChange={(e) => setFileRole(e.target.value as FileRole)}>
                {FileRoleSchema.options.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button type="submit" className="primary" disabled={!chosen.length || busy}>
            {chosen.length === 0
              ? 'Upload'
              : chosen.length === 1
                ? 'Upload 1 file'
                : `Upload ${chosen.length} files`}
          </button>
        </form>
      )}
      {uploads.length > 0 && (
        <ul aria-label="Uploads" className="stack" style={{ listStyle: 'none', padding: 0 }}>
          {uploads.map((u) => (
            <li key={u.name}>
              <label>
                {u.name}{' '}
                <progress value={u.loaded} max={u.total || 1} aria-label={`Upload progress of ${u.name}`} />{' '}
                {u.error ? (
                  <span className="error">{u.error}</span>
                ) : (
                  `${Math.floor((100 * u.loaded) / (u.total || 1))}%`
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      <ErrorMessage error={files.error} />
      <table aria-label="Files" className="data">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Role</th>
            <th scope="col">Size</th>
            <th scope="col">Format</th>
            <th scope="col">Status</th>
            <th scope="col">QC</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.data?.items.map((f) => (
            <tr key={f.id}>
              <th scope="row">{f.name}</th>
              <td>{f.role}</td>
              <td>{formatBytes(f.size_bytes)}</td>
              <td>{formatLabel(f)}</td>
              <td>
                <StatusBadge
                  label={STATUS_LABEL[f.ingest_status]}
                  tone={STATUS_TONE[f.ingest_status]}
                  live={false}
                />
              </td>
              <td>
                {f.qc_reason ?? (f.qc_report ? `${f.qc_report.checks.length} checks passed` : '')}
                {f.sha256 && (
                  <div className="hint" title={f.sha256}>
                    sha256 {f.sha256.slice(0, 12)}…
                  </div>
                )}
              </td>
              <td>
                {canImport && (f.ingest_status === 'qc_passed' || f.ingest_status === 'published') && (
                  <button type="button" onClick={() => setImporting(f)}>
                    Import…
                  </button>
                )}
              </td>
            </tr>
          ))}
          {files.data && !files.data.items.length && (
            <tr>
              <td colSpan={7}>No files yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      {importing && (
        <ImportDialog
          file={importing}
          version={version}
          programId={programId}
          onClose={() => setImporting(null)}
        />
      )}
      <QcGatePanel versionId={version.id} canApprove={canApprove ?? false} poll={inProgress || busy} />
    </section>
  );
}
