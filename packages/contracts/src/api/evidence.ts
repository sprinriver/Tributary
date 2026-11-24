import { z } from 'zod';

// Target evidence of a compound (Phase 49, EVD-01): per protein, the independent lines of evidence a team weighs,
// each against its own stated threshold. No combined score is computed.

export const TargetEvidenceQuerySchema = z
  .strictObject({
    /** The program whose data and annotations are used (compound IDs are unique within a program only). */
    program_id: z.uuid().optional(),
    /** Dose-response evidence: regulated with pEC50 (−log10 EC50 in M) at least this. */
    pec50_min: z.coerce.number().min(3).max(12).default(6),
    /** Thermal-shift evidence: adjusted p at most this in at least one comparison. */
    adj_p_max: z.coerce.number().gt(0).max(1).default(0.05),
  })
  .meta({ id: 'TargetEvidenceQuery' });

const Source = z.object({
  release_id: z.uuid(),
  experiment_id: z.uuid(),
  version_id: z.uuid(),
  experiment_name: z.string(),
  dataset_name: z.string(),
  /** Features of the compound in this dataset (curves, or TPP proteins): the denominator of each line. */
  features: z.int(),
  /** The experiment's species (NCBITaxon id), when recorded. */
  species: z.string().nullable(),
});

const MatchedBy = z.enum(['accession', 'gene symbol via target annotations', 'gene symbol only']);

const DoseItem = z.object({
  release_id: z.uuid(),
  /** The curve's feature as the tool wrote it (a protein group keeps all its accessions). */
  feature_id: z.string(),
  pec50: z.number().nullable(),
  regulation: z.string(),
  fdr: z.number().nullable(),
  matched_by: MatchedBy,
});

export const TargetEvidenceSchema = z
  .object({
    compound_id: z.string(),
    /** null when no readable program has data for the compound. */
    program_id: z.uuid().nullable(),
    programs: z.array(z.object({ program_id: z.uuid(), program_code: z.string() })),
    thresholds: z.object({ pec50_min: z.number(), adj_p_max: z.number() }),
    sources: z.object({ dose_response: z.array(Source), thermal_shift: z.array(Source) }),
    proteins: z.array(
      z.object({
        /** UniProt accession when known, else "gene:<symbol>". */
        key: z.string(),
        accession: z.string().nullable(),
        gene: z.string().nullable(),
        /** Evidence came from a protein group of several accessions and was attached to this member. */
        ambiguous_group: z.boolean(),
        annotation: z
          .object({ role: z.enum(['primary_target', 'off_target']), matched_by: MatchedBy })
          .nullable(),
        /** null: the protein has no curve for the compound (not measured). */
        dose: z
          .object({
            /** Datasets where the tool classed the protein's curve (up, down or not). */
            tested: z.int(),
            /** Datasets where it called the curve regulated (up or down). */
            regulated: z.int(),
            /** The most potent regulated curve, if any. */
            best: DoseItem.nullable(),
            /** One curve per dataset (the regulated one if any). */
            datasets: z.array(DoseItem),
          })
          .nullable(),
        /** null: the protein is not in a TPP table of the compound. */
        thermal: z
          .object({
            /** tpp_requirements: TPP's own replicate checks decide; all_comparisons: every comparison of a dataset
             * at the adjusted-p threshold with one ΔTm sign (used when the checks are not available). */
            basis: z.enum(['tpp_requirements', 'all_comparisons']),
            replicate_checks: z.enum(['met', 'not met', 'not computed']),
            direction: z.enum(['stabilised', 'destabilised', 'inconsistent', 'none']),
            rows: z.array(
              z.object({
                release_id: z.uuid(),
                feature_id: z.string(),
                comparison: z.string(),
                delta_tm: z.number().nullable(),
                /** null: the comparison did not pass TPP's curve filter (no p-value). */
                adj_p_value: z.number().nullable(),
                fulfills_all_requirements: z.boolean().nullable(),
                matched_by: MatchedBy,
              }),
            ),
          })
          .nullable(),
        /** Which lines of evidence meet their criterion. */
        lines: z.object({ dose: z.boolean(), thermal: z.boolean(), annotation: z.boolean() }),
      }),
    ),
    notes: z.array(z.string()),
  })
  .meta({ id: 'TargetEvidence' });
export type TargetEvidence = z.infer<typeof TargetEvidenceSchema>;

// Compound × protein evidence matrix (Phase 51, EVD-03): the compound page's lines for every compound of a program.
export const EvidenceMatrixQuerySchema = z
  .strictObject({
    program_id: z.uuid().optional(),
    pec50_min: z.coerce.number().min(3).max(12).default(6),
    adj_p_max: z.coerce.number().gt(0).max(1).default(0.05),
    max_proteins: z.coerce.number().int().min(1).max(500).default(200),
    max_compounds: z.coerce.number().int().min(1).max(100).default(50),
  })
  .meta({ id: 'EvidenceMatrixQuery' });

export const EvidenceMatrixSchema = z
  .object({
    program_id: z.uuid().nullable(),
    programs: z.array(z.object({ program_id: z.uuid(), program_code: z.string() })),
    thresholds: z.object({ pec50_min: z.number(), adj_p_max: z.number() }),
    compounds: z.array(
      z.object({ compound_id: z.string(), dose_datasets: z.int(), thermal_datasets: z.int() }),
    ),
    proteins: z.array(
      z.object({
        key: z.string(),
        accession: z.string().nullable(),
        gene: z.string().nullable(),
        /** Compounds with a measured line (dose-response or thermal shift) on this protein. */
        measured_compounds: z.int(),
        cells: z.record(
          z.string(),
          z.object({
            dose: z.boolean(),
            thermal: z.boolean(),
            annotation: z.enum(['primary_target', 'off_target']).nullable(),
            /** Best pEC50 of a regulated curve, if any (whether or not it meets the threshold). */
            pec50: z.number().nullable(),
            direction: z.enum(['stabilised', 'destabilised', 'inconsistent', 'none']).nullable(),
          }),
        ),
      }),
    ),
    truncated: z.object({ compounds: z.int(), proteins: z.int() }),
    notes: z.array(z.string()),
  })
  .meta({ id: 'EvidenceMatrix' });
export type EvidenceMatrix = z.infer<typeof EvidenceMatrixSchema>;
