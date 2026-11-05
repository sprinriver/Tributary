// RDKit (WASM) for compound structures (Phase 28, ADR 0028). Loaded once, lazily; every JSMol is deleted after use
// (WASM memory is not garbage-collected).
import * as rdkitPackage from '@rdkit/rdkit';
import type { JSMol, RDKitLoader, RDKitModule } from '@rdkit/rdkit';
import { CHEM_FINGERPRINT, type CompoundStructure } from '@tributary/contracts';

// The package's typings declare only types; at runtime its CommonJS export (the loader) is the ESM default.
const initRDKitModule = (rdkitPackage as unknown as { default: RDKitLoader }).default;
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

/** A substructure query: SMARTS as written, or SMILES read (and aromatised) as a molecule. */
export function withQuery<T>(
  rd: RDKitModule,
  query: string,
  type: 'smarts' | 'smiles',
  fn: (q: JSMol | null) => T,
): T {
  const q = type === 'smarts' ? rd.get_qmol(query) : rd.get_mol(query);
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

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const real = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Components of a molecule (a salt or mixture has 2 or more), from its canonical SMILES. */
export const componentCount = (mol: JSMol) => mol.get_smiles().split('.').length;

/** Descriptors of the whole registered structure; a key RDKit does not report is null, never 0. */
export function describe(
  rd: RDKitModule,
  mol: JSMol,
): Pick<CompoundStructure, 'canonical_smiles' | 'inchikey' | 'components' | 'svg' | 'descriptors'> {
  const d = JSON.parse(mol.get_descriptors()) as Record<string, unknown>;
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
    components: componentCount(mol),
    svg: svg(mol),
    descriptors: {
      mw: real(d.amw),
      exact_mw: real(d.exactmw),
      clogp: real(d.CrippenClogP),
      tpsa: real(d.tpsa),
      hbd: int(d.NumHBD),
      hba: int(d.NumHBA),
      lipinski_hbd: int(d.lipinskiHBD),
      lipinski_hba: int(d.lipinskiHBA),
      rotatable_bonds: int(d.NumRotatableBonds),
      rings: int(d.NumRings),
    },
  };
}

/** A registered SMILES RDKit reads: no whitespace (RDKit ignores text after a space), and parsable. */
export function readable(smiles: string): string | null {
  if (/\s/.test(smiles)) return 'text after a space would be ignored';
  return null;
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
