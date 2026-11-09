import type { VersionResults } from '@tributary/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { api } from '../api.ts';
import { figureToPng } from '../charts/PlotlyFigure.tsx';
import { ErrorMessage } from '../components/ui.tsx';
import { useSamples } from '../registry/queries.ts';
import { ChartView } from './ChartView.tsx';
import { writePptx } from './pptx.ts';
import { reportSlides, type ReportInput } from './report-slides.ts';
import { DoseSection, EnrichmentSection, QcSection, toolOf, type SectionData } from './ReportSections.tsx';
import { volcano } from './ResultsPage.tsx';

const TOP = 10;
const genesOf = (v: unknown) => (Array.isArray(v) ? v.join('; ') : String(v ?? ''));

/** Hit counts (from the query service) and top hits of one contrast. */
function useContrast(release: string | undefined, contrastId: string, t: VersionResults['thresholds']) {
  const where = (rules: Record<string, unknown>[]) => ({
    combinator: 'and' as const,
    rules: [{ field: 'contrast_id', operator: '=', value: contrastId }, ...rules],
  });
  const count = (fcRule: Record<string, unknown>) => ({
    queryKey: ['report-count', release, contrastId, fcRule],
    enabled: !!release,
    queryFn: () =>
      api('runQuery', {
        body: {
          source: { releaseIds: [release!] },
          where: where([{ field: 'adj_p_value', operator: '<=', value: t.p }, fcRule]),
          select: ['feature_id'],
          page: { size: 25 }, // only the count is used
        },
      }),
  });
  const [up, down, top] = useQueries({
    queries: [
      count({ field: 'log2_fc', operator: '>=', value: t.fc }),
      count({ field: 'log2_fc', operator: '<=', value: -t.fc }),
      {
        queryKey: ['report-top', release, contrastId],
        enabled: !!release,
        queryFn: () =>
          api('runQuery', {
            body: {
              source: { releaseIds: [release!] },
              where: where([{ field: 'adj_p_value', operator: 'notNull' }]),
              select: ['feature_id', 'gene_names', 'log2_fc', 'adj_p_value'],
              orderBy: [{ column: 'adj_p_value', dir: 'asc' }],
              page: { size: 25 },
            },
          }),
      },
    ],
  });
  const n = (q: typeof up) => (q.data ? (q.data.totalCapped ? null : q.data.totalRows) : null);
  return {
    up: n(up),
    down: n(down),
    top: (top.data?.rows ?? []).slice(0, TOP).map((r) => ({
      feature: String(r.feature_id),
      genes: genesOf(r.gene_names),
      log2_fc: Number(r.log2_fc),
      adj_p: Number(r.adj_p_value),
    })),
    error: up.error ?? down.error ?? top.error,
  };
}

function ContrastSection({
  r,
  release,
  contrast,
  onData,
}: {
  r: VersionResults;
  release: string;
  contrast: VersionResults['contrasts'][number];
  onData: (label: string, data: Omit<ReportInput['contrasts'][number], 'image' | 'label'>) => void;
}) {
  const c = useContrast(release, contrast.id, r.thresholds);
  onData(contrast.label, { up: c.up, down: c.down, top: c.top });
  return (
    <section
      role="region"
      aria-label={`Contrast ${contrast.label}`}
      className="stack report-section"
      data-contrast={contrast.label}
    >
      <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{contrast.label}</h2>
      <ErrorMessage error={c.error} />
      <p style={{ margin: 0 }}>
        <strong>{c.up ?? '…'}</strong> up and <strong>{c.down ?? '…'}</strong> down at |log2 FC| ≥{' '}
        {r.thresholds.fc} and adjusted p ≤ {r.thresholds.p}{' '}
        <span className="hint">
          (display thresholds, not part of the tool’s test; log2 FC = log2(numerator / denominator))
        </span>
      </p>
      <ChartView spec={volcano(release, contrast.id)} />
      <table aria-label={`Top hits — ${contrast.label}`} className="data-table">
        <thead>
          <tr>
            {['feature', 'genes', 'log2 FC', 'adjusted p'].map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.top.map((h) => (
            <tr key={h.feature}>
              <td>{h.feature}</td>
              <td>{h.genes}</td>
              <td>{h.log2_fc.toFixed(2)}</td>
              <td>{h.adj_p.toExponential(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Experiment report (Phase 33, REP-03): one page that prints cleanly (Save as PDF) and downloads as PowerPoint.
 * Every export is recorded by the API (audited). Numbers come from the API and the query service.
 */
export function ReportPage() {
  const { id } = useParams({ from: '/experiments/$id/report' });
  const search = useSearch({ from: '/experiments/$id/report' });
  const experiment = useQuery({
    queryKey: ['experiment', id],
    queryFn: () => api('getExperiment', { params: { id } }),
  });
  const versions = experiment.data?.versions ?? [];
  const version = search.version ?? versions.find((v) => v.is_latest_published)?.id ?? versions.at(-1)?.id;
  const results = useQuery({
    queryKey: ['results', version],
    queryFn: () => api('getVersionResults', { params: { id: version! } }),
    enabled: !!version,
  });
  const samples = useSamples(version);
  const [contrastData] = useState(
    () => new Map<string, Omit<ReportInput['contrasts'][number], 'image' | 'label'>>(),
  );
  // Section data for the PowerPoint, filled in as the sections render (not state: nothing re-renders on it).
  const sections = useRef<SectionData>({});
  const [busy, setBusy] = useState<'pdf' | 'pptx' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const r = results.data;
  const da = r?.releases.find((x) => x.kind === 'differential_abundance');
  const pq = r?.releases.find((x) => x.kind === 'protein_quant');
  const dr = r?.releases.find((x) => x.kind === 'dose_response');
  const generatedAt = new Date().toISOString().slice(0, 10);

  const record = (format: 'pdf' | 'pptx') =>
    api('recordReportExport', { params: { id: version! }, body: { format } });
  async function printPdf() {
    setBusy('pdf');
    setError(null);
    try {
      await record('pdf');
      window.print();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  async function downloadPptx() {
    if (!r || !experiment.data) return;
    setBusy('pptx');
    setError(null);
    try {
      await record('pptx');
      const contrasts: ReportInput['contrasts'] = [];
      for (const c of r.contrasts) {
        const plot = document.querySelector<HTMLElement>(
          `[data-contrast="${CSS.escape(c.label)}"] .js-plotly-plot`,
        );
        const data = contrastData.get(c.label) ?? { up: null, down: null, top: [] };
        contrasts.push({
          label: c.label,
          ...data,
          image: plot ? await figureToPng(plot).catch(() => null) : null,
        });
      }
      const imageOf = async (section: string) => {
        const plot = document.querySelector<HTMLElement>(`[data-section="${section}"] .js-plotly-plot`);
        return plot ? await figureToPng(plot).catch(() => null) : null;
      };
      const slides = reportSlides({
        experiment: experiment.data.name,
        program: experiment.data.program_code,
        version: r.version_number,
        assay: experiment.data.assay_type.replace(/_/g, ' '),
        samples: samples.data?.items.length ?? 0,
        generatedAt,
        methods: r.methods,
        thresholds: r.thresholds,
        contrasts,
        ...(pq && sections.current.qc ? { qc: { ...sections.current.qc, image: await imageOf('qc') } } : {}),
        ...(da && sections.current.enrichment ? { enrichment: sections.current.enrichment } : {}),
        ...(dr && sections.current.dose
          ? { dose: { ...sections.current.dose, image: await imageOf('dose') } }
          : {}),
      });
      await writePptx(
        slides,
        `${experiment.data.name}-v${r.version_number}-report.pptx`.replace(/[^\w.-]+/g, '_'),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ padding: 24 }} className="stack report">
      <p style={{ margin: 0 }} className="no-print">
        <Link to="/experiments/$id/results" params={{ id }} search={version ? { version } : {}}>
          ← Results
        </Link>
      </p>
      <header className="stack" style={{ gap: 4 }}>
        <h1 style={{ margin: 0 }}>
          {experiment.data?.name ?? '…'}
          {r ? ` · version ${r.version_number}` : ''}
        </h1>
        {experiment.data && (
          <p style={{ margin: 0 }} className="hint">
            {experiment.data.program_code} · {experiment.data.assay_type.replace(/_/g, ' ')} ·{' '}
            {samples.data ? `${samples.data.items.length} samples` : '…'} · report generated {generatedAt}
          </p>
        )}
      </header>
      <div className="row no-print">
        <button
          type="button"
          className="primary"
          disabled={!r || busy !== null}
          onClick={() => void printPdf()}
        >
          Print / save as PDF
        </button>
        <button type="button" disabled={!r || busy !== null} onClick={() => void downloadPptx()}>
          {busy === 'pptx' ? 'Building slides…' : 'Download PowerPoint'}
        </button>
      </div>
      <ErrorMessage error={experiment.error ?? results.error ?? error} />
      {r && (
        <>
          <section role="region" aria-label="Methods" className="stack report-section">
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Methods</h2>
            <p style={{ margin: 0 }}>{r.methods}</p>
          </section>
          {pq && <QcSection release={pq} onData={(d) => (sections.current.qc = d)} />}
          {da ? (
            r.contrasts.map((c) => (
              <ContrastSection
                key={c.id}
                r={r}
                release={da.id}
                contrast={c}
                onData={(label, data) => contrastData.set(label, data)}
              />
            ))
          ) : (
            <p className="hint">This version has no published differential-abundance results.</p>
          )}
          {da && <EnrichmentSection release={da} r={r} onData={(d) => (sections.current.enrichment = d)} />}
          {dr && <DoseSection release={dr} onData={(d) => (sections.current.dose = d)} />}
          <section role="region" aria-label="Data and files" className="stack report-section">
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Data and files</h2>
            <ul style={{ margin: 0 }}>
              {r.releases.map((x) => (
                <li key={x.id}>
                  {x.dataset_name} — {x.kind.replace(/_/g, ' ')}, {x.row_count} rows
                  {toolOf(x) ? ` (${toolOf(x)})` : ''}
                </li>
              ))}
              {r.files.map((f) => (
                <li key={f.id}>
                  {f.name} <span className="hint">({f.role})</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
