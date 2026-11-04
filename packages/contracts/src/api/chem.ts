import { z } from 'zod';

// Compound structures and structure search (Phase 28, CHEM-01…04). RDKit runs in apps/api; the browser only shows
// the SVG it returns.

/** Morgan fingerprint used for similarity (ECFP4-like). */
export const CHEM_FINGERPRINT = { radius: 2, nBits: 2048 } as const;

/** Descriptors of the full registered structure (every component of a salt or mixture); null if RDKit gives none. */
export const CompoundDescriptorsSchema = z.object({
  /** Average molecular weight (g/mol). */
  mw: z.number().nullable(),
  /** Monoisotopic mass (Da). */
  exact_mw: z.number().nullable(),
  /** Wildman–Crippen logP (RDKit), not BioByte ClogP. */
  clogp: z.number().nullable(),
  /** Topological polar surface area from N and O (Ertl; S and P not included), Å². */
  tpsa: z.number().nullable(),
  /** RDKit donor / acceptor counts (SMARTS definitions). */
  hbd: z.int().nullable(),
  hba: z.int().nullable(),
  /** Lipinski Rule-of-5 counts: NH + OH donors, N + O acceptors. */
  lipinski_hbd: z.int().nullable(),
  lipinski_hba: z.int().nullable(),
  rotatable_bonds: z.int().nullable(),
  rings: z.int().nullable(),
});

export const CompoundStructureQuerySchema = z
  .strictObject({
    /** Needed when the compound ID exists in more than one readable program. */
    program_id: z.uuid().optional(),
    /** Default: the first batch (numeric-aware order). */
    batch_id: z.string().min(1).max(200).optional(),
  })
  .meta({ id: 'CompoundStructureQuery' });

export const CompoundStructureSchema = z
  .object({
    compound_id: z.string(),
    program_code: z.string(),
    batch_id: z.string().nullable(),
    /** As registered for this batch. */
    smiles: z.string(),
    canonical_smiles: z.string(),
    /** Computed from the structure by RDKit (standard InChI); for a salt, the InChIKey of the whole. */
    inchikey: z.string().nullable(),
    /** Disconnected components (2 or more: a salt or mixture; descriptors cover all of them). */
    components: z.int(),
    svg: z.string(),
    descriptors: CompoundDescriptorsSchema,
    /** Every batch of this compound in the program, with its registered structure. */
    batches: z.array(z.object({ batch_id: z.string().nullable(), smiles: z.string().nullable() })),
    /** True when batches register different structures. */
    batches_differ: z.boolean(),
    rdkit_version: z.string(),
  })
  .meta({ id: 'CompoundStructure' });
export type CompoundStructure = z.infer<typeof CompoundStructureSchema>;

export const CompoundSearchBodySchema = z
  .strictObject({
    /** SMARTS or SMILES (substructure), SMILES (similarity). */
    query: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((q) => !/\s/.test(q), 'A structure has no spaces (text after a space would be ignored).'),
    mode: z.enum(['substructure', 'similarity']),
    /** Substructure only: SMARTS (atoms as written: C is aliphatic) or SMILES (read and aromatised as a molecule). */
    query_type: z.enum(['smarts', 'smiles']).default('smarts'),
    /** Tanimoto on the Morgan fingerprint; similarity mode only. */
    min_similarity: z.number().gt(0).lte(1).default(0.5),
    program_id: z.uuid().optional(),
    limit: z.int().min(1).max(500).default(100),
  })
  .meta({ id: 'CompoundSearchBody' });
export type CompoundSearchBody = z.infer<typeof CompoundSearchBodySchema>;

export const CompoundHitSchema = z.object({
  compound_id: z.string(),
  program_id: z.uuid(),
  name: z.string().nullable(),
  program_code: z.string(),
  smiles: z.string(),
  /** Batches registering this structure. */
  batch_ids: z.array(z.string().nullable()),
  /** True when other batches of the compound register a different structure. */
  batches_differ: z.boolean(),
  components: z.int(),
  /** Tanimoto similarity to the query (similarity mode), else null. */
  similarity: z.number().nullable(),
  /** Atom indices of the first match (substructure mode), else empty. */
  match_atoms: z.array(z.int()),
  /** Distinct matches of the query (substructure mode), else 0. */
  matches: z.int(),
  /** Depiction with the first match highlighted. */
  svg: z.string(),
});
export type CompoundHit = z.infer<typeof CompoundHitSchema>;

export const CompoundSearchResponseSchema = z
  .object({
    items: z.array(CompoundHitSchema),
    /** Hits before the limit. */
    total_hits: z.int(),
    /** Distinct (program, compound, structure) entries with a parsable structure that were searched. */
    searched: z.int(),
    no_structure: z.int(),
    /** Registered SMILES RDKit cannot parse (listed, never guessed). */
    invalid_structures: z.array(
      z.object({
        program_code: z.string(),
        compound_id: z.string(),
        batch_id: z.string().nullable(),
        reason: z.string(),
      }),
    ),
    provenance: z.object({
      mode: z.enum(['substructure', 'similarity']),
      query_type: z.enum(['smarts', 'smiles']).nullable(),
      query: z.string(),
      method: z.string(),
      min_similarity: z.number().nullable(),
      rdkit_version: z.string(),
    }),
  })
  .meta({ id: 'CompoundSearchResponse' });
export type CompoundSearchResponse = z.infer<typeof CompoundSearchResponseSchema>;
