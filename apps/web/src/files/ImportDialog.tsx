import type { FileSummary, VersionDetail } from '@tributary/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { api } from '../api.ts';
import { Dialog, ErrorMessage, Field } from '../components/ui.tsx';

/** A default importer from the file name (the user can change it). */
export function suggestImporter(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('pg_matrix')) return 'diann_pg_matrix';
  if (n.includes('toptable')) return 'limma_toptable';
  if (n.includes('report') && n.endsWith('.parquet')) return 'diann_report_parquet';
  if (n.includes('proteingroups')) return 'maxquant_protein_groups';
  if (n.includes('combined_protein')) return 'fragpipe_combined_protein';
  if (n.endsWith('.mzqc') || n.includes('mzqc')) return 'mzqc';
  if (n.includes('curves')) return 'curvecurator';
  if (n.includes('gene_summary')) return 'mageck_gene_summary';
  if (n.includes('precursors')) return 'alphadia_precursors';
  if (n === 'pg.matrix.tsv') return 'alphadia_pg_matrix';
  if (/compound_propert/.test(n)) return 'reference_compound_property';
  if (/^compounds?\./.test(n)) return 'reference_compound';
  if (n.includes('target_annotation')) return 'reference_target_annotation';
  if (n.includes('id_mapping') || n.includes('idmapping')) return 'reference_id_mapping';
  return 'custom_tabular';
}

export function ImportDialog({
  file,
  version,
  programId,
  onClose,
}: {
  file: FileSummary;
  version: VersionDetail;
  programId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const importers = useQuery({ queryKey: ['importers'], queryFn: () => api('listImporters') });
  const contrasts = useQuery({
    queryKey: ['contrasts', version.id],
    queryFn: () => api('listContrasts', { params: { id: version.id } }),
  });
  const presets = useQuery({
    queryKey: ['import-presets', programId],
    queryFn: () => api('listImportPresets', { params: { id: programId } }),
  });
  const [importer, setImporter] = useState(() => suggestImporter(file.name));
  const [datasetName, setDatasetName] = useState(file.name);
  const [contrastId, setContrastId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [reference, setReference] = useState({ species: '', source: '', source_release: '' });
  const [curve, setCurve] = useState({ compound_id: '', doses: '', dose_scale: '1e-9' });
  const info = importers.data?.items.find((i) => i.key === importer);
  const needs = new Set(info?.needs ?? []);

  const start = useMutation({
    mutationFn: () =>
      api('startImport', {
        body: {
          file_id: file.id,
          importer,
          dataset_name: datasetName,
          ...(needs.has('contrast') && contrastId ? { contrast_id: contrastId } : {}),
          ...(needs.has('mapping') && presetId ? { preset_id: presetId } : {}),
          ...(needs.has('source_release') ? { options: reference } : {}),
          ...(needs.has('doses')
            ? {
                options: {
                  compound_id: curve.compound_id,
                  doses: curve.doses
                    .split(/[,;\s]+/)
                    .filter(Boolean)
                    .map(Number),
                  dose_scale: Number(curve.dose_scale),
                  dose_unit: 'M',
                },
              }
            : {}),
        },
        reason: `Import ${file.name}`,
      }),
    onSuccess: (release) => void navigate({ to: '/releases/$id', params: { id: release.id } }),
  });
  const ready =
    !!info &&
    (!needs.has('mapping') || !!presetId) &&
    (!needs.has('contrast') || !!contrastId) &&
    datasetName.trim() !== '';

  return (
    <Dialog title="Import dataset" open onClose={onClose}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          start.mutate();
        }}
      >
        <p>
          <strong>{file.name}</strong> becomes a staged release; quality rules from the dataset contract run
          before anything is stored.
        </p>
        <Field label="Importer" hint={info ? `→ ${info.kinds.join(', ')} (${info.tool})` : undefined}>
          {(id) => (
            <select id={id} value={importer} onChange={(e) => setImporter(e.target.value)}>
              {importers.data?.items.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Dataset name" hint="Imports with the same name become new releases of one dataset.">
          {(id) => <input id={id} value={datasetName} onChange={(e) => setDatasetName(e.target.value)} />}
        </Field>
        {needs.has('contrast') && (
          <Field label="Contrast" hint="log2 fold change = log2(numerator / denominator)">
            {(id) => (
              <select id={id} value={contrastId} onChange={(e) => setContrastId(e.target.value)}>
                <option value="">Choose…</option>
                {contrasts.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {needs.has('mapping') && (
          <Field label="Column mapping preset">
            {(id) => (
              <select id={id} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                <option value="">Choose…</option>
                {presets.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.kind})
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {needs.has('source_release') &&
          (['species', 'source', 'source_release'] as const).map((key) => (
            <Field key={key} label={key.replace('_', ' ')}>
              {(id) => (
                <input
                  id={id}
                  value={reference[key]}
                  onChange={(e) => setReference((r) => ({ ...r, [key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
        {needs.has('doses') && (
          <>
            <Field label="Compound ID">
              {(id) => (
                <input
                  id={id}
                  value={curve.compound_id}
                  onChange={(e) => setCurve((c) => ({ ...c, compound_id: e.target.value }))}
                />
              )}
            </Field>
            <Field label="Doses" hint="As in the CurveCurator TOML, in order; control = 0">
              {(id) => (
                <input
                  id={id}
                  value={curve.doses}
                  onChange={(e) => setCurve((c) => ({ ...c, doses: e.target.value }))}
                />
              )}
            </Field>
            <Field label="Dose scale (to molar)" hint="e.g. 1e-9 when doses are in nM">
              {(id) => (
                <input
                  id={id}
                  value={curve.dose_scale}
                  onChange={(e) => setCurve((c) => ({ ...c, dose_scale: e.target.value }))}
                />
              )}
            </Field>
          </>
        )}
        <ErrorMessage error={start.error} />
        <div className="row">
          <button type="submit" className="primary" disabled={!ready || start.isPending}>
            {start.isPending ? 'Importing…' : 'Import'}
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
