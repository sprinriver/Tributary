// Protein 3D models (Phase 29, STRUC-01): a local model directory first, then AlphaFold DB. The API fetches and
// serves the file, so the browser only talks to this origin.
import type { ProteinModel } from '@tributary/contracts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiConfig } from '../config.ts';
import { HttpError, notFound } from '../errors.ts';

/** UniProt accession (with an optional isoform suffix): the only identifiers sent to AlphaFold DB. */
const UNIPROT = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-\d+)?$/;
/** Identifiers looked up in the local directory: path-safe only. */
const LOCAL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 50 * 1024 * 1024;
const CACHE_MAX = 32;
const AFDB_LICENCE = 'AlphaFold DB (EMBL-EBI and Google DeepMind), CC BY 4.0';

interface Resolved {
  model: ProteinModel;
  /** The mmCIF text, read lazily. */
  file: () => Promise<string>;
}

const cache = new Map<string, string>();
function remember(key: string, text: string): string {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, text);
  return text;
}

/** Per-residue confidence named in a ModelCIF file (ma_qa_metric, mode local), e.g. "pLDDT". */
export function confidenceMetric(cif: string): string | null {
  if (!/_ma_qa_metric\.mode/.test(cif)) return null;
  return /\bplddt\b/i.test(cif) ? 'pLDDT' : 'local QA metric';
}

export function checkAccession(id: string): void {
  if (!LOCAL_ID.test(id)) throw new HttpError(400, 'invalid_accession', 'Not a protein accession.', 'id');
}

async function local(config: ApiConfig, id: string): Promise<Resolved | null> {
  const dir = config.proteinModels.dir;
  if (!dir) return null;
  const path = join(dir, `${id}.cif`);
  const text = await readFile(path, 'utf8').catch(() => null);
  if (text === null) return null;
  const metric = confidenceMetric(text);
  return {
    model: {
      accession: id,
      source: 'local',
      source_label: 'Local model directory',
      entry_id: /^data_(\S+)/.exec(text)?.[1] ?? null,
      model_path: `/v1/proteins/${id}/model.cif`,
      // ModelCIF quality metrics mean a computed model; a plain mmCIF could be either, so it is not called predicted.
      predicted: metric !== null,
      confidence_metric: metric,
      licence: null,
      notes: text.toLowerCase().includes('synthetic') ? ['Synthetic demo model: invented geometry.'] : [],
    },
    file: async () => text,
  };
}

async function alphafold(config: ApiConfig, fetchImpl: typeof fetch, id: string): Promise<Resolved | null> {
  const base = config.proteinModels.alphafoldUrl.replace(/\/$/, '');
  if (!base || !UNIPROT.test(id)) return null;
  let res: Response;
  try {
    res = await fetchImpl(`${base}/api/prediction/${id}`, {
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
  } catch {
    throw new HttpError(503, 'model_source_unavailable', 'AlphaFold DB is not reachable.');
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, 'model_source_failed', `AlphaFold DB answered HTTP ${res.status}.`);
  const entries = (await res.json().catch(() => [])) as { entryId?: unknown; cifUrl?: unknown }[];
  const entry = Array.isArray(entries) ? entries[0] : undefined;
  if (!entry || typeof entry.cifUrl !== 'string') return null;
  const cifUrl = entry.cifUrl;
  // Only files on the configured AlphaFold DB host are fetched (the API never follows a link elsewhere).
  if (new URL(cifUrl, base).host !== new URL(base).host)
    throw new HttpError(502, 'untrusted_model_url', 'AlphaFold DB pointed to a file on another host.');
  return {
    model: {
      accession: id,
      source: 'alphafold_db',
      source_label: 'AlphaFold DB',
      entry_id: typeof entry.entryId === 'string' ? entry.entryId : null,
      model_path: `/v1/proteins/${id}/model.cif`,
      predicted: true,
      confidence_metric: 'pLDDT',
      licence: AFDB_LICENCE,
      notes: ['Predicted model, not an experimental structure: read low-pLDDT regions with care.'],
    },
    file: async () => {
      const cached = cache.get(cifUrl);
      if (cached !== undefined) return cached;
      const file = await fetchImpl(new URL(cifUrl, base), {
        signal: AbortSignal.timeout(60_000),
        redirect: 'error', // a redirect could leave the checked host
      }).catch(
        () => {
          throw new HttpError(503, 'model_source_unavailable', 'AlphaFold DB is not reachable.');
        },
      );
      if (!file.ok)
        throw new HttpError(502, 'model_source_failed', `AlphaFold DB answered HTTP ${file.status}.`);
      const text = await file.text();
      if (text.length > MAX_BYTES)
        throw new HttpError(502, 'model_too_large', 'The model file is too large.');
      return remember(cifUrl, text);
    },
  };
}

export async function resolveModel(
  config: ApiConfig,
  fetchImpl: typeof fetch,
  id: string,
): Promise<Resolved> {
  checkAccession(id);
  const found = (await local(config, id)) ?? (await alphafold(config, fetchImpl, id));
  if (!found) throw notFound('Protein model');
  return found;
}
