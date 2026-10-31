import { RunnerSchema, type AssayTypeKey, type RunnerKind } from '@tributary/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ASSAY_LABELS, ErrorMessage, Field } from '../components/ui.tsx';
import { formFields } from './nfschema.ts';
import { initialValues, ParamsForm } from './ParamsForm.tsx';

export function AdminPipelinesPage() {
  return (
    <RequireAuth>
      <AdminPipelines />
    </RequireAuth>
  );
}

const DEFAULT_OUTPUTS =
  '{\n  "diann_pg_matrix": "report.pg_matrix.tsv",\n  "limma_toptable": "toptable.tsv"\n}';

function AdminPipelines() {
  const queryClient = useQueryClient();
  const pipelines = useQuery({ queryKey: ['pipelines'], queryFn: () => api('listPipelines') });
  const [form, setForm] = useState({ key: '', name: '', repo: '', revision: '' });
  const [runners, setRunners] = useState<RunnerKind[]>(['local']);
  const [assays, setAssays] = useState<AssayTypeKey[]>(['proteomics_dia']);
  const [schema, setSchema] = useState<Record<string, unknown>>({});
  const [schemaError, setSchemaError] = useState<string>();
  const [outputs, setOutputs] = useState(DEFAULT_OUTPUTS);
  const groups = useMemo(() => formFields(schema), [schema]);
  const [preview, setPreview] = useState<Record<string, string | boolean>>({});
  const previewValues = { ...initialValues(groups, {}), ...preview };

  const save = useMutation({
    mutationFn: () => {
      const output_importers = JSON.parse(outputs) as Record<string, string>;
      const defaults = Object.fromEntries(
        groups
          .flatMap((g) => g.fields)
          .filter((f) => f.default !== undefined)
          .map((f) => [f.name, f.default!]),
      );
      return api('createPipeline', {
        body: {
          ...form,
          runner_types: runners,
          assay_types: assays,
          params_schema: schema,
          default_params: defaults,
          output_importers,
        },
        reason: `Add pipeline ${form.key}`,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      setForm({ key: '', name: '', repo: '', revision: '' });
    },
  });
  const toggle = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...new Set([...list, value])] : list.filter((v) => v !== value);

  return (
    <main className="stack">
      <h1>Pipelines</h1>
      <ErrorMessage error={pipelines.error} />
      <table className="data" aria-label="Pipelines">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Key</th>
            <th scope="col">Repository</th>
            <th scope="col">Revision</th>
            <th scope="col">Runners</th>
            <th scope="col">Assay types</th>
            <th scope="col">Outputs</th>
          </tr>
        </thead>
        <tbody>
          {pipelines.data?.items.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.name}</th>
              <td>{p.key}</td>
              <td>{p.repo}</td>
              <td>{p.revision}</td>
              <td>{p.runner_types.join(', ')}</td>
              <td>{p.assay_types.map((a) => ASSAY_LABELS[a] ?? a).join(', ')}</td>
              <td>{Object.keys(p.output_importers).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="stack card"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 style={{ margin: 0 }}>Add a pipeline</h2>
        <div className="row">
          {(['key', 'name', 'repo', 'revision'] as const).map((k) => (
            <Field key={k} label={{ key: 'Key', name: 'Name', repo: 'Repository', revision: 'Revision' }[k]}>
              {(id) => (
                <input
                  id={id}
                  value={form[k]}
                  onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                  required
                />
              )}
            </Field>
          ))}
        </div>
        <fieldset className="row">
          <legend>Runners</legend>
          {RunnerSchema.options
            .filter((r) => r !== 'fake')
            .map((r) => (
              <label key={r} className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={runners.includes(r)}
                  onChange={(e) => setRunners((l) => toggle(l, r, e.target.checked))}
                />
                {r}
              </label>
            ))}
        </fieldset>
        <fieldset className="row">
          <legend>Assay types</legend>
          {(Object.keys(ASSAY_LABELS) as AssayTypeKey[]).map((a) => (
            <label key={a} className="row" style={{ gap: 4 }}>
              <input
                type="checkbox"
                checked={assays.includes(a)}
                onChange={(e) => setAssays((l) => toggle(l, a, e.target.checked))}
              />
              {ASSAY_LABELS[a]}
            </label>
          ))}
        </fieldset>
        <Field
          label="Parameter schema (nf-schema JSON)"
          hint="nextflow_schema.json from the pipeline repository"
          error={schemaError}
        >
          {(id) => (
            <input
              id={id}
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setSchema(JSON.parse(await file.text()) as Record<string, unknown>);
                  setSchemaError(undefined);
                  setPreview({});
                } catch {
                  setSchemaError('Not valid JSON.');
                }
              }}
            />
          )}
        </Field>
        <section role="region" aria-label="Form preview" className="card">
          <h3 style={{ marginTop: 0 }}>Form preview</h3>
          <ParamsForm
            groups={groups}
            values={previewValues}
            errors={[]}
            onChange={(n, v) => setPreview((p) => ({ ...p, [n]: v }))}
          />
        </section>
        <Field label="Output importers (JSON)" hint="Importer key → path under the run's output folder">
          {(id) => <textarea id={id} rows={4} value={outputs} onChange={(e) => setOutputs(e.target.value)} />}
        </Field>
        <ErrorMessage error={save.error} />
        <div>
          <button
            type="submit"
            className="primary"
            disabled={save.isPending || !runners.length || !assays.length}
          >
            Save pipeline
          </button>
        </div>
      </form>
    </main>
  );
}
