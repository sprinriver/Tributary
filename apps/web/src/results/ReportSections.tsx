// Fuller report sections (Phase 39, REP-04…07): QC, pathway enrichment and dose-response. Numbers come from the
// query service, the chart registry and /v1/enrichment; the page computes no statistics.
import {
  chartDefaults,
  type ChartSpec,
  type EnrichmentResponse,
  type VersionResults,
} from '@tributary/contracts';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import { ErrorMessage } from '../components/ui.tsx';
import { ChartView, LAYOUT } from './ChartView.tsx';
import { qcPanelSpec } from './qc-spec.ts';
import {
  DOSE_HEAD,
  doseCells,
  doseCounts,
  ENRICHMENT_HEAD,
  enrichmentCells,
  NO_HITS,
  NO_TERMS,
  noFdr,
  PEC50_ONLY,
  PEC50_NOTE,
  QC_CAPTION,
  QC_CAPTION_BY_CONDITION,
  type DoseClass,
  type DoseRow,
  type EnrichmentContrast,
  type ReportInput,
} from './report-slides.ts';

type Release = VersionResults['releases'][number];
type Extras = Pick<ReportInput, 'qc' | 'enrichment' | 'dose'>;
/** Without the image: the page adds it from the rendered figure when building the PowerPoint. */
export type SectionData = {
  qc?: Omit<NonNullable<Extras['qc']>, 'image'> | undefined;
  enrichment?: NonNullable<Extras['enrichment']> | undefined;
  dose?: Omit<NonNullable<Extras['dose']>, 'image'> | undefined;
};

const TOP = 10;
const H2 = { margin: 0, fontSize: '1.15rem' } as const;
const genesOf = (v: unknown) => (Array.isArray(v) ? v.join('; ') : String(v ?? ''));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
export const toolOf = (x: Release) =>
  x.tool
    ? `${x.tool}${x.tool_version && x.tool_version !== 'unknown' ? ` ${x.tool_version}` : ', version not recorded'}`
    : null;

function Table({ label, head, rows }: { label: string; head: string[]; rows: string[][] }) {
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

/** REP-04: the QC panel of the version's protein-quantity release. */
export function QcSection({
  release,
  versionId,
  byCondition,
  onData,
}: {
  release: Release;
  versionId: string;
  /** Every sample has a condition: CVs within each condition (Phase 41). */
  byCondition: boolean;
  onData: (d: SectionData['qc']) => void;
}) {
  onData({ dataset: release.dataset_name, tool: toolOf(release), byCondition });
  return (
    <section role="region" aria-label="QC" className="stack report-section" data-section="qc">
      <h2 style={H2}>QC</h2>
      <p style={{ margin: 0 }}>
        {release.dataset_name}
        {toolOf(release) ? ` (${toolOf(release)})` : ''}. {byCondition ? QC_CAPTION_BY_CONDITION : QC_CAPTION}
      </p>
      <ChartView spec={qcPanelSpec(release.id, versionId, byCondition)} />
    </section>
  );
}

const CLASSES = ['up', 'down', 'not', 'unclear'] as const;

/** REP-06: curves per regulation class (as the source tool classed them), the curves figure, the top curves. */
export function DoseSection({
  release,
  onData,
}: {
  release: Release;
  onData: (d: SectionData['dose']) => void;
}) {
  const source = { releaseIds: [release.id] };
  const queries = useQueries({
    queries: [
      ...CLASSES.map((c) => ({
        queryKey: ['report-dose-count', release.id, c],
        queryFn: () =>
          api('runQuery', {
            body: {
              source,
              where: {
                combinator: 'and' as const,
                rules: [{ field: 'regulation', operator: '=', value: c }],
              },
              select: ['feature_id'],
              page: { size: 25 }, // only the count is used
            },
          }),
      })),
      {
        queryKey: ['report-dose-top', release.id],
        queryFn: () =>
          api('runQuery', {
            body: {
              source,
              where: {
                combinator: 'and' as const,
                rules: [{ field: 'regulation', operator: 'in', value: ['up', 'down'] }],
              },
              select: ['feature_id', 'gene_names', 'compound_id', 'pec50', 'regulation', 'fdr', 'method'],
              // FDR first (nulls last), then potency.
              orderBy: [
                { column: 'fdr', dir: 'asc' },
                { column: 'pec50', dir: 'desc' },
              ],
              page: { size: 25 },
            },
          }),
      },
    ],
  });
  // A capped count is a lower bound ("> n"); null only while loading or after an error.
  const counts = Object.fromEntries(
    CLASSES.map((c, i) => [c, queries[i]!.data?.totalRows ?? null]),
  ) as Record<DoseClass, number | null>;
  const capped = CLASSES.filter((_, i) => queries[i]!.data?.totalCapped);
  const topRows = queries[4]!.data?.rows ?? [];
  const top: DoseRow[] = topRows.slice(0, TOP).map((r) => ({
    feature: String(r.feature_id),
    genes: genesOf(r.gene_names),
    compound: String(r.compound_id ?? ''),
    pec50: num(r.pec50),
    regulation: String(r.regulation),
    fdr: num(r.fdr),
  }));
  const method = topRows[0]?.method ? String(topRows[0].method) : null;
  const loading = queries.some((q) => q.isPending);
  if (!loading) onData({ dataset: release.dataset_name, method, counts, capped, top });
  const spec = {
    type: 'dose_response',
    data: { source },
    encodings: { label: 'feature_id', panel: 'compound_id' },
    options: chartDefaults('dose_response'),
    layout: LAYOUT,
  } as unknown as ChartSpec;
  return (
    <section role="region" aria-label="Dose-response" className="stack report-section" data-section="dose">
      <h2 style={H2}>Dose-response</h2>
      <ErrorMessage error={queries.find((q) => q.error)?.error} />
      <p style={{ margin: 0 }}>
        {loading ? '…' : `${release.dataset_name}: ${doseCounts(counts, method, capped)}`}.{' '}
        <span className="hint">{PEC50_NOTE}</span>
      </p>
      <ChartView spec={spec} />
      <p className="hint" style={{ margin: 0 }}>
        {noFdr(top)
          ? `Top ${TOP} regulated curves (up, down), ${PEC50_ONLY}.`
          : `Top ${TOP} regulated curves (up, down) by FDR, then pEC50; curves without an FDR come last.`}
      </p>
      <Table label="Top dose-response curves" head={DOSE_HEAD} rows={top.map(doseCells)} />
    </section>
  );
}

/** REP-05: enrichment of every contrast, run on demand with the report's display thresholds. */
export function EnrichmentSection({
  release,
  r,
  onData,
}: {
  release: Release;
  r: VersionResults;
  onData: (d: SectionData['enrichment']) => void;
}) {
  const collections = useQuery({
    queryKey: ['gene-set-collections'],
    queryFn: () => api('listGeneSetCollections'),
  });
  const [chosen, setChosen] = useState('');
  const [minSize, setMinSize] = useState('10');
  const collection = chosen || collections.data?.items[0]?.id || '';
  const run = useMutation({
    // One contrast at a time; a contrast without hits (422 no_hits) is a result, not a failure of the others.
    mutationFn: async () => {
      const out: { label: string; result?: EnrichmentResponse; skipped?: string }[] = [];
      for (const c of r.contrasts) {
        try {
          const result = await api('runEnrichment', {
            body: {
              release_id: release.id,
              collection_id: collection,
              ...(r.contrasts.length > 1 ? { contrast_label: c.label } : {}),
              direction: 'both',
              adj_p_max: r.thresholds.p,
              abs_log2fc_min: r.thresholds.fc,
              min_size: Number(minSize),
              max_size: 500,
              universe: 'measured',
            },
          });
          out.push({ label: c.label, result });
        } catch (e) {
          if (e instanceof ApiError && e.body.code === 'no_hits')
            out.push({ label: c.label, skipped: NO_HITS });
          else throw e;
        }
      }
      return out;
    },
  });
  const results = run.data;
  const first = results?.find((x) => x.result)?.result?.provenance;
  const t = r.thresholds;
  const settings = `Hits: adjusted p ≤ ${first?.thresholds.adj_p_max ?? t.p} and |log2 FC| ≥ ${first?.thresholds.abs_log2fc_min ?? t.fc}, both directions; sets with ${first?.thresholds.min_size ?? minSize}–${first?.thresholds.max_size ?? 500} measured members; universe: ${first?.universe ?? 'measured'}`;
  const method = first ? `Method: ${first.method}; adjusted p: ${first.adj_method}.` : '';
  const chosenCollection = collections.data?.items.find((c) => c.id === collection);
  const collectionName = first
    ? `${first.collection.name} — ${first.collection.source} ${first.collection.source_release}`
    : chosenCollection
      ? `${chosenCollection.name} — ${chosenCollection.source} ${chosenCollection.source_release}`
      : '';
  const contrasts: EnrichmentContrast[] = (results ?? []).map((x) => {
    if (!x.result)
      return { label: x.label, skipped: x.skipped ?? NO_HITS, summary: '', notes: [], terms: [] };
    const p = x.result.provenance;
    const passing = x.result.terms.filter((term) => term.adj_p_value <= p.thresholds.term_fdr).length;
    return {
      label: p.contrast_label,
      summary: `${p.hits} hits of ${p.background} background; ${p.tested} sets tested${
        p.tested ? `; ${passing} at adjusted p ≤ ${p.thresholds.term_fdr}` : ''
      }`,
      // The dot-plot note describes a figure the report does not show.
      notes: p.transformations.filter((n) => !n.startsWith('Dot plot:')),
      terms: x.result.terms.slice(0, TOP).map((term) => ({
        id: term.id,
        name: term.name,
        overlap: term.overlap,
        size: term.size,
        fold: term.fold_enrichment,
        adj_p: term.adj_p_value,
      })),
    };
  });
  onData(results ? { collection: collectionName, settings, method, contrasts } : undefined);
  const none = collections.data && collections.data.items.length === 0;
  return (
    <section
      role="region"
      aria-label="Pathway enrichment"
      // Not printed until it has a result.
      className={`stack report-section${results ? '' : ' no-print'}`}
    >
      <h2 style={H2}>Pathway enrichment</h2>
      {none ? (
        <p className="hint">
          No gene-set collections yet: a system administrator imports GO or Reactome (GMT).
        </p>
      ) : (
        <div className="row no-print" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="stack" style={{ gap: 4 }}>
            <span>Gene sets</span>
            <select
              value={collection}
              onChange={(e) => {
                run.reset();
                setChosen(e.target.value);
              }}
            >
              {collections.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.source} {c.source_release}
                </option>
              ))}
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span>Minimum set size</span>
            <input
              type="number"
              min={1}
              step={1}
              value={minSize}
              onChange={(e) => {
                run.reset();
                setMinSize(e.target.value);
              }}
            />
          </label>
          <button
            type="button"
            disabled={!collection || run.isPending || !(Number(minSize) >= 1)}
            onClick={() => run.mutate()}
          >
            {run.isPending ? 'Running…' : 'Add to report'}
          </button>
        </div>
      )}
      <ErrorMessage error={collections.error ?? run.error} />
      {results && (
        <>
          <p style={{ margin: 0 }}>
            Gene sets: {collectionName}. {settings} (the report’s display thresholds). {method}
          </p>
          <p className="hint" style={{ margin: 0 }}>
            Top {TOP} sets per contrast by p-value.
          </p>
          {contrasts.map((c) => (
            <div key={c.label} className="stack" style={{ gap: 4 }}>
              <h3 style={{ margin: 0, fontSize: '1rem' }}>{c.label}</h3>
              <p style={{ margin: 0 }}>{c.skipped ?? `${c.summary}.`}</p>
              {c.skipped ? null : c.terms.length ? (
                <Table
                  label={`Enrichment — ${c.label}`}
                  head={ENRICHMENT_HEAD}
                  rows={c.terms.map(enrichmentCells)}
                />
              ) : (
                <p className="hint">{NO_TERMS}</p>
              )}
              {c.notes.length > 0 && (
                <ul className="hint" style={{ margin: 0 }}>
                  {c.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
