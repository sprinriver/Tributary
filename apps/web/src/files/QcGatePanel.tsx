import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Field } from '../components/ui.tsx';

/** SPEC M3 QC gate: why a pipeline launch is blocked, and the approver override (reason required, audited). */
export function QcGatePanel({
  versionId,
  canApprove,
  poll,
  label = 'Pipeline launch gate',
  title = 'Pipeline launch',
}: {
  versionId: string;
  canApprove: boolean;
  poll: boolean;
  label?: string;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const gate = useQuery({
    queryKey: ['qc-gate', versionId],
    queryFn: () => api('getQcGate', { params: { id: versionId } }),
    refetchInterval: 1500,
    refetchIntervalInBackground: poll,
  });
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const override = useMutation({
    mutationFn: () => api('overrideQcGate', { params: { id: versionId }, body: { reason } }),
    onSuccess: async () => {
      setOpen(false);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: ['qc-gate', versionId] });
    },
  });
  const data = gate.data;
  const failed = data?.blockers.filter((b) => b.status === 'qc_failed') ?? [];

  return (
    <section role="region" aria-label={label} className="card stack">
      <h3 style={{ margin: 0 }}>{title}</h3>
      <ErrorMessage error={gate.error} />
      {data && (
        <>
          <p style={{ margin: 0 }}>
            <strong>{data.can_launch ? 'Launch allowed' : 'Launch blocked'}</strong>
            {data.can_launch && !data.overridden.length && ' — every file passed QC.'}
          </p>
          {data.blockers.length > 0 && (
            <ul>
              {data.blockers.map((b) => (
                <li key={b.file_id}>
                  <strong>{b.name}</strong>: {b.reason}
                </li>
              ))}
            </ul>
          )}
          {data.override && data.overridden.length > 0 && (
            <p style={{ margin: 0 }}>
              QC overridden by {data.override.created_by_name ?? 'an approver'} on{' '}
              {new Date(data.override.created_at).toLocaleString()}: “{data.override.reason}”
            </p>
          )}
          {canApprove && failed.length > 0 && (
            <div>
              <button type="button" onClick={() => setOpen(true)}>
                Override QC
              </button>
            </div>
          )}
        </>
      )}
      <Dialog title="Override failed QC" open={open} onClose={() => setOpen(false)}>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            // React submit events bubble through portals/nested forms: keep this one out of an enclosing form.
            e.stopPropagation();
            override.mutate();
          }}
        >
          <p>
            Pipelines will be allowed to run on {failed.length} file(s) that failed QC. The reason is recorded
            in the audit log.
          </p>
          <Field label="Reason" hint="At least 10 characters.">
            {(id) => <textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}
          </Field>
          <ErrorMessage error={override.error} />
          <div className="row">
            <button
              type="submit"
              className="primary"
              disabled={reason.trim().length < 10 || override.isPending}
            >
              Override
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
