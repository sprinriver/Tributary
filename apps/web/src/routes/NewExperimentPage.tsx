import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { MetadataFieldDef } from '@tributary/contracts';
import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { RequireAuth } from '../components/Layout.tsx';
import { ASSAY_LABELS, ErrorMessage, Field } from '../components/ui.tsx';
import { usePrograms, useRegistryInvalidation } from '../registry/queries.ts';

const SPECIES = [
  { id: 'NCBITaxon:9606', label: 'Homo sapiens' },
  { id: 'NCBITaxon:10090', label: 'Mus musculus' },
  { id: 'NCBITaxon:10116', label: 'Rattus norvegicus' },
];
const FIELD_TYPES = ['text', 'number', 'integer', 'boolean', 'date'] as const;

interface CustomRow {
  key: string;
  label: string;
  type: (typeof FIELD_TYPES)[number];
  value: string;
  searchable: boolean;
}

const STEPS = ['Details', 'Custom fields', 'Review'] as const;

export function NewExperimentPage() {
  return (
    <RequireAuth>
      <Wizard />
    </RequireAuth>
  );
}

function Wizard() {
  const navigate = useNavigate();
  const invalidate = useRegistryInvalidation();
  const programs = usePrograms();
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState({
    program_id: '',
    assay_type: 'proteomics_dia',
    name: '',
    experiment_date: '',
    species: SPECIES[0]!.id,
    spectral_library: '',
    time_points: '',
    description: '',
  });
  const [custom, setCustom] = useState<CustomRow[]>([]);
  const set = (patch: Partial<typeof details>) => setDetails((d) => ({ ...d, ...patch }));
  const programId = details.program_id || programs.data?.items[0]?.id || '';

  const create = useMutation({
    mutationFn: () =>
      api('createExperiment', {
        reason: 'New experiment',
        body: {
          program_id: programId,
          assay_type: details.assay_type as 'proteomics_dia',
          name: details.name,
          ...(details.experiment_date ? { experiment_date: details.experiment_date } : {}),
          species: SPECIES.find((s) => s.id === details.species) ?? null,
          ...(details.spectral_library ? { spectral_library: details.spectral_library } : {}),
          time_points: details.time_points
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          description: details.description,
          custom_fields: custom.map((c): MetadataFieldDef => ({
            scope: 'experiment',
            key: c.key,
            label: c.label || c.key,
            type: c.type,
            required: false,
            searchable: c.searchable,
          })),
          custom: Object.fromEntries(custom.filter((c) => c.value !== '').map((c) => [c.key, c.value])),
        },
      }),
    onSuccess: async (experiment) => {
      await invalidate();
      void navigate({ to: '/experiments/$id', params: { id: experiment.id } });
    },
  });
  const fieldError = (field: string) =>
    create.error instanceof ApiError
      ? (create.error.body.errors?.find((e) => e.field === field)?.message ??
        (create.error.body.field === field ? create.error.body.message : undefined))
      : undefined;
  const detailsValid = details.name.trim().length > 0 && programId !== '';

  return (
    <main>
      <p>
        <Link to="/experiments">← Experiment list</Link>
      </p>
      <h1>New experiment</h1>
      <ol aria-label="Steps" className="row" style={{ listStyle: 'none', padding: 0 }}>
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? 'step' : undefined}
            style={{ fontWeight: i === step ? 700 : 400 }}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="stack" aria-labelledby="step-details" style={{ maxWidth: 560 }}>
          <h2 id="step-details">Details</h2>
          <Field label="Program">
            {(id) => (
              <select id={id} value={programId} onChange={(e) => set({ program_id: e.target.value })}>
                {programs.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Assay type">
            {(id) => (
              <select
                id={id}
                value={details.assay_type}
                onChange={(e) => set({ assay_type: e.target.value })}
              >
                {Object.entries(ASSAY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Name" error={fieldError('name')}>
            {(id) => (
              <input id={id} required value={details.name} onChange={(e) => set({ name: e.target.value })} />
            )}
          </Field>
          <Field label="Experiment date">
            {(id) => (
              <input
                id={id}
                type="date"
                value={details.experiment_date}
                onChange={(e) => set({ experiment_date: e.target.value })}
              />
            )}
          </Field>
          <Field label="Species">
            {(id) => (
              <select id={id} value={details.species} onChange={(e) => set({ species: e.target.value })}>
                {SPECIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Spectral library">
            {(id) => (
              <input
                id={id}
                value={details.spectral_library}
                onChange={(e) => set({ spectral_library: e.target.value })}
              />
            )}
          </Field>
          <Field
            label="Time points"
            hint="Comma-separated, with units, e.g. 6 h, 24 h"
            error={fieldError('time_points.0')}
          >
            {(id) => (
              <input
                id={id}
                value={details.time_points}
                onChange={(e) => set({ time_points: e.target.value })}
              />
            )}
          </Field>
          <Field label="Description">
            {(id) => (
              <textarea
                id={id}
                rows={3}
                value={details.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            )}
          </Field>
        </section>
      )}

      {step === 1 && (
        <section className="stack" aria-labelledby="step-custom">
          <h2 id="step-custom">Custom fields</h2>
          <p className="muted">Experiment-level fields. Searchable fields are indexed for search.</p>
          {custom.map((row, i) => (
            <fieldset key={i} className="row">
              <legend>Custom field {i + 1}</legend>
              <Field label="Key" hint="lower_snake_case" error={fieldError(`custom_fields.${i}.key`)}>
                {(id) => (
                  <input
                    id={id}
                    value={row.key}
                    onChange={(e) =>
                      setCustom((c) => c.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))
                    }
                  />
                )}
              </Field>
              <Field label="Label">
                {(id) => (
                  <input
                    id={id}
                    value={row.label}
                    onChange={(e) =>
                      setCustom((c) => c.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))
                    }
                  />
                )}
              </Field>
              <Field label="Type">
                {(id) => (
                  <select
                    id={id}
                    value={row.type}
                    onChange={(e) =>
                      setCustom((c) =>
                        c.map((r, j) => (j === i ? { ...r, type: e.target.value as CustomRow['type'] } : r)),
                      )
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Value" error={fieldError(`custom.${row.key}`)}>
                {(id) => (
                  <input
                    id={id}
                    value={row.value}
                    onChange={(e) =>
                      setCustom((c) => c.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
                    }
                  />
                )}
              </Field>
              <label className="row" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={row.searchable}
                  onChange={(e) =>
                    setCustom((c) => c.map((r, j) => (j === i ? { ...r, searchable: e.target.checked } : r)))
                  }
                />
                Searchable
              </label>
              <button
                type="button"
                className="danger"
                onClick={() => setCustom((c) => c.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </fieldset>
          ))}
          <div>
            <button
              type="button"
              onClick={() =>
                setCustom((c) => [...c, { key: '', label: '', type: 'text', value: '', searchable: false }])
              }
            >
              Add field
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="stack" aria-labelledby="step-review">
          <h2 id="step-review">Review</h2>
          <dl className="details">
            <dt>Program</dt>
            <dd>{programs.data?.items.find((p) => p.id === programId)?.code}</dd>
            <dt>Assay type</dt>
            <dd>{ASSAY_LABELS[details.assay_type]}</dd>
            <dt>Name</dt>
            <dd>{details.name}</dd>
            <dt>Experiment date</dt>
            <dd>{details.experiment_date || '—'}</dd>
            <dt>Time points</dt>
            <dd>{details.time_points || '—'}</dd>
            <dt>Custom fields</dt>
            <dd>
              {custom.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {custom.map((c) => (
                    <li key={c.key}>
                      {c.key}
                      {c.searchable ? ' (searchable)' : ''}: {c.value || '—'}
                    </li>
                  ))}
                </ul>
              ) : (
                'None'
              )}
            </dd>
          </dl>
          <ErrorMessage error={create.error} />
        </section>
      )}

      <div className="toolbar">
        {step > 0 && (
          <button type="button" onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="primary"
            disabled={!detailsValid}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={create.isPending || !detailsValid}
            onClick={() => create.mutate()}
          >
            Create experiment
          </button>
        )}
      </div>
    </main>
  );
}
