import type { AssayTypeKey, RunnerKind } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Field } from '../components/ui.tsx';
import { QcGatePanel } from '../files/QcGatePanel.tsx';
import { experimentPrefill, formFields, validateParams } from './nfschema.ts';
import { initialValues, ParamsForm } from './ParamsForm.tsx';

export interface LaunchTarget {
  versionId: string;
  programId: string;
  assayType: AssayTypeKey;
}

/** Launch dialog (SPEC M4): pipeline, runner, nf-schema form, QC gate with approver override. */
export function LaunchDialog({
  target,
  canApprove,
  initial,
  onClose,
  onLaunched,
}: {
  target: LaunchTarget;
  canApprove: boolean;
  /** Re-run with edits: the previous run's pipeline and parameters. */
  initial?:
    { pipelineId: string; runner: RunnerKind; params: Record<string, string | number | boolean> } | undefined;
  onClose: () => void;
  onLaunched: (runId: string) => void;
}) {
  const queryClient = useQueryClient();
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => api('listPipelines') });
  const gate = useQuery({
    queryKey: ['qc-gate', target.versionId],
    queryFn: () => api('getQcGate', { params: { id: target.versionId } }),
  });
  const version = useQuery({
    queryKey: ['version', target.versionId],
    queryFn: () => api('getVersion', { params: { id: target.versionId } }),
  });
  const usable = (pipelines.data?.items ?? []).filter((p) => p.assay_types.includes(target.assayType));
  const [pipelineId, setPipelineId] = useState(initial?.pipelineId ?? '');
  const pipeline = usable.find((p) => p.id === pipelineId) ?? usable[0];
  const [runner, setRunner] = useState<RunnerKind | ''>(initial?.runner ?? '');
  const [values, setValues] = useState<Record<string, Record<string, string | boolean>>>({});
  const groups = useMemo(() => formFields(pipeline?.params_schema), [pipeline]);
  const current =
    pipeline &&
    (values[pipeline.id] ??
      initialValues(groups, pipeline.default_params, {
        // Experiment facts beat definition defaults; a re-run's own values beat both.
        ...(version.data
          ? experimentPrefill(
              groups.flatMap((g) => g.fields),
              version.data,
            )
          : {}),
        ...(initial?.pipelineId === pipeline.id ? initial.params : {}),
      }));
  const fields = groups.flatMap((g) => g.fields);
  const validation = current ? validateParams(fields, current) : null;
  const chosenRunner = (runner || pipeline?.runner_types[0]) as RunnerKind | undefined;

  const launch = useMutation({
    mutationFn: () => {
      if (!pipeline || !chosenRunner || !validation?.ok) throw new Error('Fix the form first.');
      // Parameters the schema does not describe (definition defaults) are sent as they are.
      const params = { ...pipeline.default_params, ...validation.values };
      return api('launchRun', {
        body: {
          pipeline_definition_id: pipeline.id,
          experiment_version_id: target.versionId,
          runner: chosenRunner,
          params,
        },
        reason: `Launch ${pipeline.key}`,
      });
    },
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ['experiments'] });
      onLaunched(run.id);
    },
  });
  const formId = useId();
  const canLaunch =
    !!pipeline && !!chosenRunner && !!validation?.ok && gate.data?.can_launch === true && !launch.isPending;

  return (
    <Dialog title="Launch pipeline" open onClose={onClose}>
      <form
        id={formId}
        className="stack"
        style={{ minWidth: 'min(640px, 90vw)' }}
        onSubmit={(e) => {
          e.preventDefault();
          launch.mutate();
        }}
      >
        <ErrorMessage error={pipelines.error} />
        {pipelines.data && !usable.length && <p>No pipeline is defined for this assay type yet.</p>}
        <div className="row">
          <Field label="Pipeline">
            {(id) => (
              <select id={id} value={pipeline?.id ?? ''} onChange={(e) => setPipelineId(e.target.value)}>
                {usable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Runner">
            {(id) => (
              <select
                id={id}
                value={chosenRunner ?? ''}
                onChange={(e) => setRunner(e.target.value as RunnerKind)}
              >
                {pipeline?.runner_types.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {pipeline && current && (
          <ParamsForm
            groups={groups}
            values={current}
            errors={validation && !validation.ok ? validation.errors : []}
            onChange={(name, value) =>
              setValues((v) => ({ ...v, [pipeline.id]: { ...current, [name]: value } }))
            }
          />
        )}
      </form>
      {/* Outside the launch form: the override dialog has its own form, and nested forms submit natively. */}
      <div className="stack">
        <QcGatePanel
          versionId={target.versionId}
          canApprove={canApprove}
          poll
          label="QC gate"
          title="QC gate"
        />
        <ErrorMessage error={launch.error} />
        <div className="row">
          <button type="submit" form={formId} className="primary" disabled={!canLaunch}>
            {launch.isPending ? 'Launching…' : 'Launch'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Approver for a program: approver, program admin or system admin (CASL roles, Phase 3). */
export function canApproveIn(
  roles: { program_id: string | null; role: string }[] | undefined,
  programId: string,
): boolean {
  return (roles ?? []).some(
    (r) =>
      r.role === 'system_admin' ||
      (r.program_id === programId && (r.role === 'approver' || r.role === 'admin')),
  );
}
