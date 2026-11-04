// RDKit (WASM) for compound structures (Phase 28, ADR 0028). Loaded once, lazily; every JSMol is deleted after use
// (WASM memory is not garbage-collected).
import initRDKitModule, { type JSMol, type RDKitModule } from '@rdkit/rdkit';
import { CHEM_FINGERPRINT, type CompoundStructure } from '@tributary/contracts';

let loading: Promise<RDKitModule> | undefined;
export const rdkit = (): Promise<RDKitModule> => (loading ??= initRDKitModule());

/** Runs `fn` with a parsed molecule (null when RDKit cannot parse it) and frees it. */
export function withMol<T>(rd: RDKitModule, smiles: string, fn: (mol: JSMol | null) => T): T {
  const mol = rd.get_mol(smiles);
  try {
    return fn(mol);
  } finally {
    mol?.delete();
  }
}

/** A query for substructure search: SMARTS (which also reads most SMILES). */
export function withQuery<T>(rd: RDKitModule, query: string, fn: (q: JSMol | null) => T): T {
  const q = rd.get_qmol(query);
  try {
    return fn(q);
  } finally {
    q?.delete();
  }
}

const SVG = { width: 280, height: 200 };

export function svg(mol: JSMol, atoms: number[] = [], bonds: number[] = []): string {
  return atoms.length
    ? mol.get_svg_with_highlights(JSON.stringify({ atoms, bonds, ...SVG }))
    : mol.get_svg(SVG.width, SVG.height);
}

export function describe(
  rd: RDKitModule,
  mol: JSMol,
): Omit<CompoundStructure, 'compound_id' | 'smiles' | 'rdkit_version'> {
  const d = JSON.parse(mol.get_descriptors()) as Record<string, number>;
  let inchikey: string | null;
  try {
    const inchi = mol.get_inchi();
    inchikey = inchi ? rd.get_inchikey_for_inchi(inchi) || null : null;
  } catch {
    inchikey = null; // some structures have no InChI
  }
  return {
    canonical_smiles: mol.get_smiles(),
    inchikey,
    svg: svg(mol),
    descriptors: {
      mw: d.amw ?? NaN,
      clogp: d.CrippenClogP ?? NaN,
      tpsa: d.tpsa ?? NaN,
      hbd: d.NumHBD ?? 0,
      hba: d.NumHBA ?? 0,
      rotatable_bonds: d.NumRotatableBonds ?? 0,
      rings: d.NumRings ?? 0,
    },
  };
}

/** Morgan fingerprint bits as a string of "0"/"1". */
export const fingerprint = (mol: JSMol) => mol.get_morgan_fp(JSON.stringify(CHEM_FINGERPRINT));

/** Tanimoto coefficient of two bit strings of equal length (0 when both are empty). */
export function tanimoto(a: string, b: string): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a.charCodeAt(i) === 49;
    const y = b.charCodeAt(i) === 49;
    if (x && y) both++;
    if (x || y) either++;
  }
  return either === 0 ? 0 : both / either;
}
