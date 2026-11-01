import { DATASET_CONTRACTS, type DatasetKind } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { Field } from '../components/ui.tsx';

export interface SourceDraft {
  kind: DatasetKind;
  /** A single release (by experiment), or '' for every release of the kind in my programs. */
  releaseId: string;
  latestOnly: boolean;
}

const CATEGORY_LABEL = {
  experiment: 'Experiment data',
  reference: 'Reference data',
  metadata: 'Metadata tables',
};
export const KINDS = Object.values(DATASET_CONTRACTS);
export const kindLabel = (kind: string) => kind.replaceAll('_', ' ');

/** Kind select grouped by category (SPEC M6 picker: by experiment, by kind, reference, metadata tables). */
export function KindSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (k: DatasetKind) => void;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as DatasetKind)}>
      {(['experiment', 'reference', 'metadata'] as const).map((category) => (
        <optgroup key={category} label={CATEGORY_LABEL[category]}>
          {KINDS.filter((c) => c.category === category).map((c) => (
            <option key={c.kind} value={c.kind}>
              {kindLabel(c.kind)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function DatasetPicker({
  value,
  onChange,
}: {
  value: SourceDraft;
  onChange: (v: SourceDraft) => void;
}) {
  const category = DATASET_CONTRACTS[value.kind].category;
  const datasets = useQuery({
    queryKey: ['datasets', { kind: value.kind }],
    queryFn: () => api('listDatasets', { query: { kind: value.kind } }),
    enabled: category !== 'metadata',
  });
  const published = (datasets.data?.items ?? []).filter((d) => d.latest_release?.status === 'published');
  return (
    <section
      role="region"
      aria-label="Dataset"
      className="card row"
      style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}
    >
      <Field label="Dataset kind">
        {(id) => (
          <KindSelect
            id={id}
            value={value.kind}
            onChange={(kind) => onChange({ kind, releaseId: '', latestOnly: value.latestOnly })}
          />
        )}
      </Field>
      {category !== 'metadata' && (
        <Field label="Release">
          {(id) => (
            <select
              id={id}
              value={value.releaseId}
              onChange={(e) => onChange({ ...value, releaseId: e.target.value })}
            >
              <option value="">All releases in my programs</option>
              {published.map((d) => (
                <option key={d.id} value={d.latest_release!.id}>
                  {d.name} · {d.program_code}
                  {d.experiment_name ? ` · ${d.experiment_name} v${d.version_number}` : ''} · r
                  {d.latest_release!.release_number}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {!value.releaseId && category !== 'reference' && (
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={value.latestOnly}
            onChange={(e) => onChange({ ...value, latestOnly: e.target.checked })}
          />
          Latest published versions only
        </label>
      )}
    </section>
  );
}
