import { z } from 'zod';

// Compound structures and structure search (Phase 28, CHEM-01…04). RDKit runs in apps/api; the browser only shows
// the SVG it returns.

/** Morgan fingerprint used for similarity (ECFP4-like). */
export const CHEM_FINGERPRINT = { radius: 2, nBits: 2048 } as const;

export const CompoundDescriptorsSchema = z.object({
  /** Average molecular weight (g/mol). */
  mw: z.number(),
  /** Crippen cLogP. */
  clogp: z.number(),
  /** Topological polar surface area (Å²). */
  tpsa: z.number(),
  hbd: z.int(),
  hba: z.int(),
  rotatable_bonds: z.int(),
  rings: z.int(),
});

export const CompoundStructureSchema = z
  .object({
    compound_id: z.string(),
    /** As registered. */
    smiles: z.string(),
    canonical_smiles: z.string(),
    /** Computed from the structure by RDKit (the registered InChIKey, if any, is on the compound page). */
    inchikey: z.string().nullable(),
    svg: z.string(),
    descriptors: CompoundDescriptorsSchema,
    rdkit_version: z.string(),
  })
  .meta({ id: 'CompoundStructure' });
export type CompoundStructure = z.infer<typeof CompoundStructureSchema>;

export const CompoundSearchBodySchema = z
  .strictObject({
    /** SMARTS or SMILES (substructure), SMILES (similarity). */
    query: z.string().trim().min(1).max(2000),
    mode: z.enum(['substructure', 'similarity']),
    /** Tanimoto on the Morgan fingerprint; similarity mode only. */
    min_similarity: z.number().gt(0).lte(1).default(0.5),
    program_id: z.uuid().optional(),
    limit: z.int().min(1).max(500).default(100),
  })
  .meta({ id: 'CompoundSearchBody' });
export type CompoundSearchBody = z.infer<typeof CompoundSearchBodySchema>;

export const CompoundHitSchema = z.object({
  compound_id: z.string(),
  name: z.string().nullable(),
  program_code: z.string(),
  smiles: z.string(),
  /** Tanimoto similarity to the query (similarity mode), else null. */
  similarity: z.number().nullable(),
  /** Atom indices matched by the query (substructure mode), else empty. */
  match_atoms: z.array(z.int()),
  /** Depiction with the match highlighted. */
  svg: z.string(),
});
export type CompoundHit = z.infer<typeof CompoundHitSchema>;

export const CompoundSearchResponseSchema = z
  .object({
    items: z.array(CompoundHitSchema),
    /** Hits before the limit. */
    total_hits: z.int(),
    /** Compounds with a parsable structure that were searched. */
    searched: z.int(),
    no_structure: z.int(),
    /** Registered SMILES RDKit cannot parse (listed, never guessed). */
    invalid_structures: z.array(z.string()),
    provenance: z.object({
      mode: z.enum(['substructure', 'similarity']),
      query: z.string(),
      method: z.string(),
      min_similarity: z.number().nullable(),
      rdkit_version: z.string(),
    }),
  })
  .meta({ id: 'CompoundSearchResponse' });
export type CompoundSearchResponse = z.infer<typeof CompoundSearchResponseSchema>;
