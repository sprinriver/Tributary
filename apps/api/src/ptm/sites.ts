// Modification sites (Phase 47, PTM-03): the sites of a protein across readable site releases, and the summary of one
// release. Counting and display only: localisation probabilities and intensities are the tool's own
// (packages/importers/src/maxquant_sites/SOURCE.md).
import { QueryResultSchema, type ProteinSites, type SiteSummary } from '@tributary/contracts';
import type { Database } from '@tributary/db';
import type { ApiConfig } from '../config.ts';
import { latestReleases, type LatestRelease } from '../datasets/latest-releases.ts';
import { callQueryService } from '../datasets/query-client.ts';
import { HttpError } from '../errors.ts';
import { resolveSource } from '../query/resolve.ts';

type Deps = { db: Database; config: ApiConfig; fetch: typeof fetch };
type Row = Record<string, unknown>;
type Where = { field: string; operator: string; value?: unknown }[];

/** Rows read per release; more is refused, never truncated. */
const MAX_ROWS = 500_000;
const TOP = 25;

export const LOCALISATION_NOTE = (locMin: number) =>
  `${locMin} is a display threshold: sites at or above it are marked, sites below it are listed and marked, never dropped. 0.75 is a common choice, after the "class I" sites of Olsen et al. 2006 (Cell 127:635, doi:10.1016/j.cell.2006.09.026); see the paper for its full definition.`;
export const QUANTIFIED_NOTE =
  'Quantified: an intensity above 0 at any multiplicity (MaxQuant writes 0 for a site it did not quantify). Intensities of different multiplicities are different peptides (one, two, three or more modifications) and are never added or compared; intensities are not normalised or compared here.';
export const ISOFORM_NOTE =
  'Sites are matched on the exact accession: isoform accessions (e.g. P31749-2) have their own page.';
export const MAP_NOTE = 'Site map: y is the localisation probability, not abundance.';

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

async function rowsOf(deps: Deps, releaseId: string, select: string[], where: Where): Promise<Row[]> {
  const source = await resolveSource(deps.db, { releaseIds: [releaseId] }, null);
  if (!source) return [];
  const result = QueryResultSchema.parse(
    await callQueryService(deps.fetch, deps.config, '/internal/query', {
      spec: { source: { releaseIds: [releaseId] }, select, where: { combinator: 'and', rules: where } },
      source,
      joins: [],
      all_rows: MAX_ROWS,
    }),
  );
  if (result.totalRows > result.rows.length || result.nextCursor)
    throw new HttpError(
      422,
      'too_many_rows',
      `More than ${MAX_ROWS.toLocaleString('en')} site rows in one release; this view cannot count them.`,
      'release_id',
    );
  return result.rows;
}

const SITE_COLUMNS = [
  'site_id',
  'protein',
  'protein_ids',
  'positions_in_proteins',
  'amino_acid',
  'position',
  'modification',
  'localization_prob',
  'sequence_window',
  'sample_key',
  'multiplicity',
  'intensity',
  'method',
];

type Site = ProteinSites['sites'][number];

/** One entry per site of the release on this protein (rows are one per site × sample × multiplicity). */
export function sitesOfProtein(releaseId: string, accession: string, rows: Row[], locMin: number): Site[] {
  const bySite = new Map<string, Row[]>();
  for (const r of rows) bySite.set(String(r.site_id), [...(bySite.get(String(r.site_id)) ?? []), r]);
  const samples = new Set(rows.map((r) => String(r.sample_key))).size;
  return [...bySite].map(([siteId, rs]) => {
    const first = rs[0]!;
    const ids = list(first.protein_ids);
    const at = ids.indexOf(accession);
    // This protein's position: the site's own position when reported on it, else its entry in positions_in_proteins.
    const position =
      String(first.protein) === accession
        ? num(first.position)
        : at >= 0
          ? num(list(first.positions_in_proteins)[at])
          : null;
    const measured = rs.filter((r) => (num(r.intensity) ?? 0) > 0);
    const loc = num(first.localization_prob);
    return {
      release_id: releaseId,
      site_id: siteId,
      amino_acid: String(first.amino_acid ?? ''),
      position: position !== null && Number.isInteger(position) ? position : null,
      modification: String(first.modification ?? ''),
      localization_prob: loc,
      meets_threshold: loc !== null && loc >= locMin,
      samples_quantified: new Set(measured.map((r) => String(r.sample_key))).size,
      samples_total: samples,
      multiplicities: [
        ...new Set(measured.map((r) => num(r.multiplicity)).filter((m): m is number => m !== null)),
      ].sort((a, b) => a - b),
      shared_with: ids.filter((id) => id !== accession),
      sequence_window: first.sequence_window == null ? null : String(first.sequence_window),
    };
  });
}

/** A site has a point on the map when it has a position on this protein and a localisation probability. */
export const plotted = (x: Site) => x.position !== null && x.localization_prob !== null;

/** Site map: position along the protein against localisation probability, threshold dashed. */
export function siteFigure(
  sites: Site[],
  locMin: number,
  releases: ProteinSites['releases'],
): ProteinSites['figure'] {
  if (!sites.length) return null;
  const experiment = (id: string) => releases.find((r) => r.release_id === id)?.experiment_name ?? '';
  const trace = (meets: boolean) => {
    const s = sites.filter((x) => x.meets_threshold === meets && plotted(x));
    return {
      type: 'scatter',
      mode: 'markers+text',
      name: meets ? `localisation ≥ ${locMin}` : `below ${locMin}`,
      x: s.map((x) => x.position),
      y: s.map((x) => x.localization_prob),
      text: s.map((x) => `${x.amino_acid}${x.position}`),
      textposition: 'top center',
      customdata: s.map((x) => [x.site_id, x.samples_quantified, x.samples_total, experiment(x.release_id)]),
      hovertemplate:
        '%{customdata[0]}<br>localisation %{y:.3f}<br>quantified in %{customdata[1]} / %{customdata[2]} samples<br>%{customdata[3]}<extra></extra>',
      marker: { size: 11, symbol: meets ? 'circle' : 'circle-open', color: meets ? '#0e7c86' : '#8c959f' },
    };
  };
  return {
    data: [trace(true), trace(false)],
    layout: {
      xaxis: { title: { text: 'position in protein' }, rangemode: 'tozero' },
      yaxis: { title: { text: 'localisation probability' }, range: [0, 1.08] },
      shapes: [
        {
          type: 'line',
          xref: 'paper',
          yref: 'y',
          x0: 0,
          x1: 1,
          y0: locMin,
          y1: locMin,
          line: { color: '#57606a', dash: 'dash', width: 1 },
        },
      ],
      showlegend: true,
      height: 340,
      margin: { t: 30 },
    },
  };
}

export async function proteinSites(
  deps: Deps,
  readable: string[] | null,
  accession: string,
  locMin: number,
): Promise<Omit<ProteinSites, 'figure' | 'notes' | 'protein' | 'loc_min'>> {
  const releases: ProteinSites['releases'] = [];
  const sites: Site[] = [];
  for (const r of await latestReleases(deps.db, 'ptm_site_quant', readable)) {
    const rows = await rowsOf(deps, r.release_id, SITE_COLUMNS, [
      { field: 'protein_ids', operator: 'contains', value: accession },
    ]);
    if (!rows.length) continue;
    // Samples of the release: every site has a row per sample, so the protein's rows name them all.
    releases.push(toRelease(r, rows));
    sites.push(...sitesOfProtein(r.release_id, accession, rows, locMin));
  }
  sites.sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.release_id.localeCompare(b.release_id),
  );
  return { releases, sites };
}

const toRelease = (r: LatestRelease, rows: Row[]): ProteinSites['releases'][number] => ({
  release_id: r.release_id,
  dataset_name: r.dataset_name,
  version_id: r.version_id,
  experiment_id: r.experiment_id,
  experiment_name: r.experiment_name,
  experiment_date: r.experiment_date,
  program_code: r.program_code,
  method: rows[0]?.method == null ? null : String(rows[0].method),
  samples: new Set(rows.map((x) => String(x.sample_key))).size,
});

/** Summary of one site release: distinct sites, sites meeting the threshold, sites quantified per sample, top sites. */
export async function siteSummary(deps: Deps, releaseId: string, locMin: number): Promise<SiteSummary> {
  const rows = await rowsOf(
    deps,
    releaseId,
    [
      'site_id',
      'protein',
      'gene_names',
      'modification',
      'localization_prob',
      'localization_prob_sample',
      'sample_key',
      'intensity',
    ],
    [],
  );
  const sites = new Map<
    string,
    { protein: string; genes: string[]; loc: number | null; samples: Set<string> }
  >();
  // Per sample: sites quantified, and those localised at loc_min or better in that sample.
  const perSample = new Map<string, { all: Set<string>; meeting: Set<string> }>();
  const mods = new Set<string>();
  for (const r of rows) {
    const id = String(r.site_id);
    const s = sites.get(id) ?? {
      protein: String(r.protein),
      genes: list(r.gene_names),
      loc: num(r.localization_prob),
      samples: new Set(),
    };
    sites.set(id, s);
    mods.add(String(r.modification));
    const sample = String(r.sample_key);
    if (!perSample.has(sample)) perSample.set(sample, { all: new Set(), meeting: new Set() });
    if ((num(r.intensity) ?? 0) > 0) {
      s.samples.add(sample);
      perSample.get(sample)!.all.add(id);
      const here = num(r.localization_prob_sample);
      if (here !== null && here >= locMin) perSample.get(sample)!.meeting.add(id);
    }
  }
  const all = [...sites];
  return {
    release_id: releaseId,
    modification: [...mods].sort().join(', '),
    loc_min: locMin,
    sites: all.length,
    meeting_threshold: all.filter(([, s]) => s.loc !== null && s.loc >= locMin).length,
    per_sample: [...perSample]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sample_key, ids]) => ({
        sample_key,
        sites_quantified: ids.all.size,
        sites_quantified_meeting_threshold: ids.meeting.size,
      })),
    top: all
      .sort(
        ([ai, a], [bi, b]) =>
          (b.loc ?? -1) - (a.loc ?? -1) || b.samples.size - a.samples.size || ai.localeCompare(bi),
      )
      .slice(0, TOP)
      .map(([site_id, s]) => ({
        site_id,
        protein: s.protein,
        gene_names: s.genes,
        localization_prob: s.loc,
        samples_quantified: s.samples.size,
      })),
    notes: [
      LOCALISATION_NOTE(locMin),
      `Sites per sample meeting the threshold use the localisation probability in that sample (MaxQuant "Localization prob <sample>"); the site total uses the best over all samples.`,
      QUANTIFIED_NOTE,
    ],
  };
}
