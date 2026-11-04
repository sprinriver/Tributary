// Structure search over the compounds of readable programs (Phase 28, CHEM-02/03).
import {
  CHEM_FINGERPRINT,
  type CompoundHit,
  type CompoundSearchBody,
  type CompoundSearchResponse,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { HttpError } from '../errors.ts';
import { fingerprint, rdkit, svg, tanimoto, withMol, withQuery } from './rdkit.ts';

/** Compounds one search reads; more means choose a program. */
export const MAX_SEARCHED = 50_000;
/** Fingerprints by SMILES, kept between searches (cleared when full). */
const FP_CACHE = new Map<string, string>();
const FP_CACHE_MAX = 100_000;

const METHOD = {
  substructure: 'RDKit substructure match (query read as SMARTS)',
  similarity: `RDKit Morgan fingerprints (radius ${CHEM_FINGERPRINT.radius}, ${CHEM_FINGERPRINT.nBits} bits), Tanimoto similarity`,
};

export async function searchCompounds(
  db: Database,
  readable: string[] | null,
  body: CompoundSearchBody,
): Promise<CompoundSearchResponse> {
  const rd = await rdkit();
  const empty = (): CompoundSearchResponse => ({
    items: [],
    total_hits: 0,
    searched: 0,
    no_structure: 0,
    invalid_structures: [],
    provenance: {
      mode: body.mode,
      query: body.query,
      method: METHOD[body.mode],
      min_similarity: body.mode === 'similarity' ? body.min_similarity : null,
      rdkit_version: rd.version(),
    },
  });
  const invalidQuery = () =>
    new HttpError(
      422,
      'invalid_query',
      body.mode === 'substructure'
        ? 'RDKit cannot read this query as SMARTS or SMILES.'
        : 'RDKit cannot read this query as SMILES.',
      'query',
    );
  // Validate the query before reading anything.
  const queryFp =
    body.mode === 'similarity'
      ? withMol(rd, body.query, (m) => (m ? fingerprint(m) : null))
      : withQuery(rd, body.query, (q) => (q ? '' : null));
  if (queryFp === null) throw invalidQuery();
  if (readable?.length === 0) return empty();

  let q = db
    .selectFrom('compound as c')
    .innerJoin('program as p', 'p.id', 'c.program_id')
    .select(['c.compound_id', 'c.name', 'c.smiles', 'p.code as program_code'])
    .distinctOn(['c.program_id', 'c.compound_id'])
    .where('c.deleted_at', 'is', null);
  if (readable) q = q.where('c.program_id', 'in', readable);
  if (body.program_id) q = q.where('c.program_id', '=', body.program_id);
  const compounds = await q
    .orderBy('c.program_id')
    .orderBy('c.compound_id')
    .orderBy('c.batch_id')
    .limit(MAX_SEARCHED + 1)
    .execute();
  if (compounds.length > MAX_SEARCHED)
    throw new HttpError(
      422,
      'too_many_compounds',
      `More than ${MAX_SEARCHED} compounds: choose a program.`,
      'program_id',
    );

  const result = empty();
  const hits: CompoundHit[] = [];
  // The query molecule lives for the whole loop and is freed afterwards.
  const qmol = body.mode === 'substructure' ? rd.get_qmol(body.query) : null;
  try {
    for (const c of compounds) {
      const smiles = c.smiles?.trim();
      if (!smiles) {
        result.no_structure++;
        continue;
      }
      withMol(rd, smiles, (mol) => {
        if (!mol) {
          result.invalid_structures.push(c.compound_id);
          return;
        }
        result.searched++;
        const base = { compound_id: c.compound_id, name: c.name, program_code: c.program_code, smiles };
        if (body.mode === 'substructure') {
          const match = JSON.parse(mol.get_substruct_match(qmol!)) as { atoms?: number[]; bonds?: number[] };
          if (!match.atoms?.length) return;
          hits.push({
            ...base,
            similarity: null,
            match_atoms: match.atoms,
            svg: svg(mol, match.atoms, match.bonds),
          });
        } else {
          let fp = FP_CACHE.get(smiles);
          if (!fp) {
            fp = fingerprint(mol);
            if (FP_CACHE.size >= FP_CACHE_MAX) FP_CACHE.clear();
            FP_CACHE.set(smiles, fp);
          }
          const similarity = tanimoto(queryFp, fp);
          if (similarity < body.min_similarity) return;
          hits.push({ ...base, similarity, match_atoms: [], svg: '' });
        }
      });
    }
  } finally {
    qmol?.delete();
  }
  if (body.mode === 'similarity')
    hits.sort((a, b) => b.similarity! - a.similarity! || a.compound_id.localeCompare(b.compound_id));
  result.total_hits = hits.length;
  result.items = hits.slice(0, body.limit);
  // Depictions only for the hits returned (similarity hits are drawn after ranking).
  for (const h of result.items) if (!h.svg) h.svg = withMol(rd, h.smiles, (m) => (m ? svg(m) : ''));
  return result;
}
