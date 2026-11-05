// Structure search over the compounds of readable programs (Phase 28, CHEM-02/03). Every distinct registered
// structure of a compound (batches may differ) is searched.
import {
  CHEM_FINGERPRINT,
  type CompoundHit,
  type CompoundSearchBody,
  type CompoundSearchResponse,
} from '@tributary/contracts';
import type { Database } from '@tributary/db';
import { HttpError } from '../errors.ts';
import { compoundRows, groupByStructure } from './compounds.ts';
import {
  componentCount,
  fingerprint,
  rdkit,
  readable as readableSmiles,
  svg,
  tanimoto,
  withMol,
} from './rdkit.ts';

/** Compound rows (batches) one search reads; more means choose a program. */
export const MAX_SEARCHED = 50_000;
/** Fingerprints by SMILES, kept between searches (cleared when full). */
const FP_CACHE = new Map<string, string>();
const FP_CACHE_MAX = 100_000;
const STEREO = 'stereochemistry ignored (enantiomers match and score 1)';

const method = (body: CompoundSearchBody) =>
  body.mode === 'substructure'
    ? `RDKit substructure match, query read as ${body.query_type === 'smiles' ? 'SMILES (aromatised molecule)' : 'SMARTS (atoms as written)'}; ${STEREO}`
    : `RDKit Morgan fingerprints (radius ${CHEM_FINGERPRINT.radius}, ${CHEM_FINGERPRINT.nBits} bits), Tanimoto similarity; ${STEREO}; salts compared whole`;

export async function searchCompounds(
  db: Database,
  readable: string[] | null,
  body: CompoundSearchBody,
): Promise<CompoundSearchResponse> {
  const rd = await rdkit();
  const substructure = body.mode === 'substructure';
  const result: CompoundSearchResponse = {
    items: [],
    total_hits: 0,
    searched: 0,
    no_structure: 0,
    invalid_structures: [],
    provenance: {
      mode: body.mode,
      query_type: substructure ? body.query_type : null,
      query: body.query,
      method: method(body),
      min_similarity: substructure ? null : body.min_similarity,
      rdkit_version: rd.version(),
    },
  };
  // The query molecule lives for the whole search and is freed afterwards; it is validated before any read.
  const qmol = substructure
    ? body.query_type === 'smarts'
      ? rd.get_qmol(body.query)
      : rd.get_mol(body.query)
    : rd.get_mol(body.query);
  if (!qmol)
    throw new HttpError(
      422,
      'invalid_query',
      `RDKit cannot read this query as ${substructure && body.query_type === 'smarts' ? 'SMARTS' : 'SMILES'}.`,
      'query',
    );
  try {
    const queryFp = substructure ? '' : fingerprint(qmol);
    if (readable?.length === 0) return result;
    const rows = await compoundRows(db, readable, { programId: body.program_id, limit: MAX_SEARCHED + 1 });
    if (rows.length > MAX_SEARCHED)
      throw new HttpError(
        422,
        'too_many_compounds',
        `More than ${MAX_SEARCHED} compound batches: choose a program.`,
        'program_id',
      );
    const hits: CompoundHit[] = [];
    for (const entry of groupByStructure(rows)) {
      const smiles = entry.smiles;
      if (!smiles) {
        result.no_structure++;
        continue;
      }
      const invalid = (reason: string) =>
        result.invalid_structures.push({
          program_code: entry.program_code,
          compound_id: entry.compound_id,
          batch_id: entry.batch_ids[0] ?? null,
          reason,
        });
      const unreadable = readableSmiles(smiles);
      if (unreadable) {
        invalid(unreadable);
        continue;
      }
      withMol(rd, smiles, (mol) => {
        if (!mol) return invalid('RDKit cannot parse it');
        result.searched++;
        const base = {
          compound_id: entry.compound_id,
          program_id: entry.program_id,
          name: entry.name,
          program_code: entry.program_code,
          smiles,
          batch_ids: entry.batch_ids,
          batches_differ: entry.batches_differ,
          components: componentCount(mol),
        };
        if (substructure) {
          const all = JSON.parse(mol.get_substruct_matches(qmol)) as { atoms: number[]; bonds: number[] }[];
          const first = all[0];
          if (!first?.atoms.length) return;
          hits.push({
            ...base,
            similarity: null,
            match_atoms: first.atoms,
            matches: all.length,
            svg: svg(mol, first.atoms, first.bonds),
          });
        } else {
          let fp = FP_CACHE.get(smiles);
          if (!fp) {
            fp = fingerprint(mol);
            if (FP_CACHE.size >= FP_CACHE_MAX) FP_CACHE.clear();
            FP_CACHE.set(smiles, fp);
          }
          const similarity = tanimoto(queryFp, fp);
          if (similarity >= body.min_similarity)
            hits.push({ ...base, similarity, match_atoms: [], matches: 0, svg: '' });
        }
      });
    }
    if (!substructure)
      hits.sort((a, b) => b.similarity! - a.similarity! || a.compound_id.localeCompare(b.compound_id));
    result.total_hits = hits.length;
    result.items = hits.slice(0, body.limit);
    // Similarity hits are drawn after ranking, only those returned.
    for (const h of result.items) if (!h.svg) h.svg = withMol(rd, h.smiles, (m) => (m ? svg(m) : ''));
    return result;
  } finally {
    qmol.delete();
  }
}
