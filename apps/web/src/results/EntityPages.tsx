import { CompoundStructurePanel } from '../chem/Structure.tsx';
import type { ChartSpec } from '@tributary/contracts';
import { useQuery } from '@tanstack/react-query';
import { AddToTriage } from '../triage/AddToTriage.tsx';
import { WatchButton } from '../watch/WatchButton.tsx';
import { Link, useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { ChartView, LAYOUT } from './ChartView.tsx';
import { DoseResponseViewer } from './DoseResponseViewer.tsx';

function Table({ label, head, rows }: { label: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <table aria-label={label} className="data-table">
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section role="region" aria-label={title} className="stack">
    <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{title}</h2>
    {children}
  </section>
);
const MAX_VOLCANOES = 6;
const num = (v: unknown, digits = 3) => (v === null || v === undefined ? '' : Number(v).toPrecision(digits));

/** SPEC M8 protein page: annotations, every experiment and contrast it was measured in, dose-response curves. */
export function ProteinPage() {
  const { id } = useParams({ from: '/proteins/$id' });
  const protein = useQuery({
    queryKey: ['protein', id],
    queryFn: () => api('getProtein', { params: { id } }),
  });
  const has = {
    combinator: 'and' as const,
    rules: [{ field: 'protein_ids', operator: 'contains' as const, value: id }],
  };
  const measured = useQuery({
    queryKey: ['protein-da', id],
    queryFn: () =>
      api('runQuery', {
        body: {
          source: { kind: 'differential_abundance', scope: {} },
          joins: [
            {
              type: 'inner',
              target: { kind: 'experiment_version', scope: {} },
              alias: 'ev',
              on: [{ left: 'experiment_version_id', op: '=', right: 'ev.experiment_version_id' }],
            },
          ],
          where: has,
          select: [
            'ev.experiment_id',
            'ev.experiment_name',
            'ev.version_number',
            'contrast_label',
            'log2_fc',
            'adj_p_value',
          ],
          orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
          page: { size: 100 },
        },
      }),
  });
  const curves = useQuery({
    queryKey: ['protein-dr', id],
    queryFn: () =>
      api('runQuery', {
        body: {
          source: { kind: 'dose_response', scope: {} },
          where: has,
          select: ['feature_id'],
          page: { size: 25 },
        },
      }),
  });
  return (
    <main style={{ padding: 24 }} className="stack">
      <h1 style={{ margin: 0 }}>
        {id}
        {protein.data?.gene_symbol ? ` · ${protein.data.gene_symbol}` : ''}
      </h1>
      <WatchButton
        kind="protein"
        itemKey={id}
        {...(protein.data?.gene_symbol ? { label: protein.data.gene_symbol } : {})}
      />
      <ErrorMessage error={protein.error ?? measured.error} />
      <AddToTriage
        kind="protein"
        itemKey={id}
        {...(protein.data?.gene_symbol ? { label: protein.data.gene_symbol } : {})}
      />
      <Section title="Annotations">
        <Table
          label="Annotations"
          head={['key', 'value', 'family']}
          rows={(protein.data?.annotations ?? []).map((a) => [a.key, a.value, a.family])}
        />
      </Section>
      <Section title="Measured in">
        <Table
          label="Measured in"
          head={['experiment', 'version', 'contrast', 'log2 FC', 'adjusted p']}
          rows={(measured.data?.rows ?? []).map((r) => [
            <Link key="e" to="/experiments/$id/results" params={{ id: String(r['ev.experiment_id']) }}>
              {String(r['ev.experiment_name'])}
            </Link>,
            String(r['ev.version_number']),
            String(r.contrast_label),
            num(r.log2_fc),
            r.adj_p_value === null ? '' : Number(r.adj_p_value).toExponential(2),
          ])}
        />
      </Section>
      {(curves.data?.totalRows ?? 0) > 0 && (
        <Section title="Dose-response">
          <DoseResponseViewer source={{ kind: 'dose_response', scope: {} }} where={has} />
        </Section>
      )}
    </main>
  );
}

/** SPEC M8 compound page: properties/ADME, targets, contrasts it was tested in, volcanoes with its targets highlighted. */
export function CompoundPage() {
  const { id } = useParams({ from: '/compounds/$id' });
  const compound = useQuery({
    queryKey: ['compound', id],
    queryFn: () => api('getCompound', { params: { id } }),
  });
  const targets = useQuery({
    queryKey: ['compound-targets', id],
    queryFn: () =>
      api('runQuery', {
        body: {
          source: { kind: 'target_annotation', scope: {} },
          where: {
            combinator: 'and',
            rules: [
              { field: 'key', operator: 'in', value: ['primary_target', 'off_target'] },
              { field: 'value', operator: '=', value: id },
            ],
          },
          select: ['uniprot_accession', 'gene_symbol', 'key'],
          page: { size: 100 },
        },
      }),
  });
  const accessions = [...new Set((targets.data?.rows ?? []).map((r) => String(r.uniprot_accession)))];
  const c = compound.data;
  return (
    <main style={{ padding: 24 }} className="stack">
      <h1 style={{ margin: 0 }}>
        {id}
        {c?.compound.name ? ` · ${c.compound.name}` : ''}
      </h1>
      <WatchButton kind="compound" itemKey={id} {...(c?.compound.name ? { label: c.compound.name } : {})} />
      <ErrorMessage error={compound.error} />
      <AddToTriage kind="compound" itemKey={id} {...(c?.compound.name ? { label: c.compound.name } : {})} />
      {c && (
        <>
          <p style={{ margin: 0 }} className="hint">
            {c.compound.program_code}
            {c.compound.smiles ? ` · SMILES ${c.compound.smiles}` : ''}
          </p>
          {c.compound.smiles && <CompoundStructurePanel id={id} />}
          <Section title="Properties and ADME">
            <Table
              label="Properties"
              head={['category', 'property', 'value', 'unit', 'assay']}
              rows={c.properties.map((p) => [
                p.assay_category,
                p.property,
                `${p.qualifier === '=' ? '' : p.qualifier}${num(p.value, 4)}`,
                p.unit ?? '',
                p.assay_name ?? '',
              ])}
            />
          </Section>
          <Section title="Targets">
            <Table
              label="Targets"
              head={['protein', 'gene', 'relation']}
              rows={(targets.data?.rows ?? []).map((r) => [
                <Link key="p" to="/proteins/$id" params={{ id: String(r.uniprot_accession) }}>
                  {String(r.uniprot_accession)}
                </Link>,
                String(r.gene_symbol ?? ''),
                String(r.key),
              ])}
            />
          </Section>
          <Section title="Omics results">
            <Table
              label="Contrasts"
              head={['experiment', 'version', 'contrast']}
              rows={c.contrasts.map((k) => [
                <Link key="e" to="/experiments/$id/results" params={{ id: k.experiment_id }}>
                  {k.experiment_name}
                </Link>,
                String(k.version_number),
                k.label,
              ])}
            />
          </Section>
          {c.contrasts.filter((k) => k.release_id).length > MAX_VOLCANOES && (
            <p className="hint" style={{ margin: 0 }}>
              Volcano plots for the {MAX_VOLCANOES} most recent contrasts; open an experiment's results for
              the others.
            </p>
          )}
          {c.contrasts
            .filter((k) => k.release_id)
            .slice(0, MAX_VOLCANOES)
            .map((k) => (
              <section
                key={k.contrast_id}
                role="region"
                aria-label={`Volcano — ${k.experiment_name}`}
                className="stack"
              >
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>
                  Volcano — {k.experiment_name} · {k.label}
                </h2>
                <ChartView
                  spec={
                    {
                      type: 'volcano',
                      data: {
                        source: { releaseIds: [k.release_id] },
                        where: {
                          combinator: 'and',
                          rules: [{ field: 'contrast_id', operator: '=', value: k.contrast_id }],
                        },
                      },
                      encodings: { x: 'log2_fc', y: 'adj_p_value', label: 'protein_ids' },
                      options: accessions.length
                        ? { highlight: accessions, highlight_label: 'Known targets' }
                        : {},
                      layout: LAYOUT,
                    } as ChartSpec
                  }
                />
              </section>
            ))}
        </>
      )}
    </main>
  );
}
