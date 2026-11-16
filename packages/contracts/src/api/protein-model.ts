import { z } from 'zod';

// 3D models of proteins (Phase 29, STRUC-01…03): a local model directory (in-house models, mirrors, the demo) or
// AlphaFold DB, served by the API from the same origin so the browser never fetches other hosts.

export const ProteinModelSchema = z
  .object({
    accession: z.string(),
    source: z.enum(['local', 'alphafold_db']),
    /** Human-readable source, e.g. "AlphaFold DB" or "Local model directory". */
    source_label: z.string(),
    /** The model's entry ID at its source, when it gives one. */
    entry_id: z.string().nullable(),
    /** Path of the mmCIF file on this API (same origin). */
    model_path: z.string(),
    /** A predicted model (not an experimental structure). */
    predicted: z.boolean(),
    /** Per-residue confidence carried by the file (ModelCIF ma_qa_metric), e.g. "pLDDT". */
    confidence_metric: z.string().nullable(),
    /** Terms of the source data. */
    licence: z.string().nullable(),
    notes: z.array(z.string()),
  })
  .meta({ id: 'ProteinModel' });
export type ProteinModel = z.infer<typeof ProteinModelSchema>;
