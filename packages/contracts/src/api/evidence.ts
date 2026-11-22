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
        /** How the evidence rows were matched to this protein. */
        matched_by: z.enum(['accession', 'gene symbol via target annotations', 'gene symbol only']),
        annotation: z.enum(['primary_target', 'off_target']).nullable(),
        /** The most potent regulated curve of the compound for this protein, if any. */
        dose: z
          .object({
            release_id: z.uuid(),
            feature_id: z.string(),
            pec50: z.number().nullable(),
            regulation: z.string(),
            fdr: z.number().nullable(),
          })
          .nullable(),
        /** Every TPP comparison of the compound for this protein. */
        thermal: z.array(
          z.object({
            release_id: z.uuid(),
            comparison: z.string(),
            delta_tm: z.number().nullable(),
            adj_p_value: z.number().nullable(),
            fulfills_all_requirements: z.boolean().nullable(),
          }),
        ),
        /** Which lines of evidence meet their threshold. */
        lines: z.object({ dose: z.boolean(), thermal: z.boolean(), annotation: z.boolean() }),
      }),
    ),
    notes: z.array(z.string()),
  })
  .meta({ id: 'TargetEvidence' });
export type TargetEvidence = z.infer<typeof TargetEvidenceSchema>;
