// UniProt REST API client (public annotation plan, stage 1). Entries are fetched by accession from
// /uniprotkb/accessions (https://www.uniprot.org/help/api_retrieve_entries); the service names its release in the
// X-UniProt-Release header. Checked against rest.uniprot.org, release 2026_04: unknown accessions are left out of
// `results`, and one badly formatted accession makes the whole request fail with 400, so callers send UniProt-format
// accessions only. UniProt data: CC BY 4.0 (https://www.uniprot.org/help/license).
import { HttpError } from '../errors.ts';
import { outboundHeaders } from '../outbound.ts';

/** UniProt accession format (https://www.uniprot.org/help/accession_numbers), optionally with an isoform suffix. */
export const UNIPROT_ACCESSION =
  /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-\d+)?$/;

const FIELDS = 'accession,gene_primary,protein_name,cc_function,cc_subcellular_location,organism_name';
const BATCH = 100;

export interface UniprotEntry {
  accession: string;
  gene: string | null;
  proteinName: string | null;
  function: string | null;
  /** Subcellular locations in UniProt's order, without duplicates. */
  locations: string[];
  organism: string | null;
}

export interface UniprotBatch {
  release: string;
  releaseDate: string | null;
  entries: UniprotEntry[];
}

type Raw = {
  primaryAccession?: string;
  organism?: { scientificName?: string };
  proteinDescription?: {
    recommendedName?: { fullName?: { value?: string } };
    submissionNames?: { fullName?: { value?: string } }[];
  };
  genes?: { geneName?: { value?: string } }[];
  comments?: {
    commentType?: string;
    texts?: { value?: string }[];
    subcellularLocations?: { location?: { value?: string } }[];
  }[];
};

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseEntry(raw: Raw): UniprotEntry | null {
  const accession = text(raw.primaryAccession);
  if (!accession) return null;
  const comments = raw.comments ?? [];
  const functions = comments
    .filter((c) => c.commentType === 'FUNCTION')
    .flatMap((c) => (c.texts ?? []).map((t) => text(t.value)))
    .filter((v): v is string => v !== null);
  const locations = [
    ...new Set(
      comments
        .filter((c) => c.commentType === 'SUBCELLULAR LOCATION')
        .flatMap((c) => (c.subcellularLocations ?? []).map((l) => text(l.location?.value)))
        .filter((v): v is string => v !== null),
    ),
  ];
  const description = raw.proteinDescription;
  return {
    accession,
    gene: text(raw.genes?.[0]?.geneName?.value),
    proteinName:
      text(description?.recommendedName?.fullName?.value) ??
      text(description?.submissionNames?.[0]?.fullName?.value),
    function: functions.length ? functions.join(' ') : null,
    locations,
    organism: text(raw.organism?.scientificName),
  };
}

/** Fetches entries in batches; every batch must come from the same UniProt release. */
export async function fetchUniprotEntries(
  fetchImpl: typeof fetch,
  baseUrl: string,
  accessions: string[],
): Promise<UniprotBatch> {
  const base = baseUrl.replace(/\/$/, '');
  if (!base) throw new HttpError(422, 'uniprot_disabled', 'UniProt is switched off (UNIPROT_URL is empty).');
  const invalid = accessions.find((a) => !UNIPROT_ACCESSION.test(a));
  if (invalid) throw new Error(`Not a UniProt accession: ${invalid}`); // a programming error: callers filter first
  let release: string | null = null;
  let releaseDate: string | null = null;
  const entries: UniprotEntry[] = [];
  for (let i = 0; i < accessions.length; i += BATCH) {
    const url = new URL(`${base}/uniprotkb/accessions`);
    url.searchParams.set('accessions', accessions.slice(i, i + BATCH).join(','));
    url.searchParams.set('fields', FIELDS);
    url.searchParams.set('format', 'json');
    let res: Response;
    try {
      res = await fetchImpl(url, {
        headers: outboundHeaders({ accept: 'application/json' }),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
    } catch {
      throw new HttpError(503, 'uniprot_unavailable', 'UniProt is not reachable.');
    }
    if (!res.ok) throw new HttpError(502, 'uniprot_failed', `UniProt answered HTTP ${res.status}.`);
    const batchRelease = text(res.headers.get('x-uniprot-release'));
    if (!batchRelease) throw new HttpError(502, 'uniprot_failed', 'UniProt did not name its release.');
    if (release !== null && batchRelease !== release)
      throw new HttpError(
        502,
        'uniprot_release_changed',
        `UniProt changed release during the refresh (${release} → ${batchRelease}); run it again.`,
      );
    release = batchRelease;
    releaseDate = text(res.headers.get('x-uniprot-release-date'));
    const body = (await res.json().catch(() => null)) as { results?: Raw[] } | null;
    if (!body || !Array.isArray(body.results))
      throw new HttpError(502, 'uniprot_failed', 'UniProt returned an unexpected response.');
    for (const raw of body.results) {
      const entry = parseEntry(raw);
      if (entry) entries.push(entry);
    }
  }
  if (release === null)
    throw new HttpError(422, 'uniprot_nothing_to_fetch', 'No UniProt accessions to fetch.');
  return { release, releaseDate, entries };
}
