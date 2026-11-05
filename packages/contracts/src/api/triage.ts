import { z } from 'zod';

// Hit triage board (Phase 25, TRI-01…04): proteins and compounds a program decides on — advance, watch or drop — with
// owners, comments, evidence snapshots from releases, and an append-only history. Every change keeps its reason.

export const TriageKindSchema = z.enum(['protein', 'compound']);
export const TriageStatusSchema = z.enum(['new', 'advance', 'watch', 'drop']);
export type TriageStatus = z.infer<typeof TriageStatusSchema>;

const EvidenceRef = z.strictObject({
  release_id: z.uuid(),
  /** For differential-abundance releases with several contrasts ("numerator vs denominator"). */
  contrast_label: z.string().min(1).max(500).optional(),
});

export const CreateTriageBodySchema = z
  .strictObject({
    program_id: z.uuid(),
    kind: TriageKindSchema,
    /** UniProt accession (protein) or compound id. */
    key: z.string().trim().min(1).max(100),
    label: z.string().trim().max(200).optional(),
    evidence: EvidenceRef.optional(),
  })
  .meta({ id: 'CreateTriageBody' });

export const UpdateTriageBodySchema = z
  .strictObject({
    status: TriageStatusSchema.optional(),
    /** null clears the owner. */
    owner_id: z.uuid().nullable().optional(),
    /** Why: required for a status change (a decision keeps its reason). */
    reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(2000).optional(),
  })
  .refine((b) => b.status !== undefined || b.owner_id !== undefined, {
    message: 'Change the status or the owner',
    path: ['status'],
  })
  .refine((b) => b.status === undefined || b.reason !== undefined, {
    message: 'A status change needs a reason',
    path: ['reason'],
  })
  .meta({ id: 'UpdateTriageBody' });

export const TriageCommentBodySchema = z
  .strictObject({ text: z.string().trim().min(1).max(5000) })
  .meta({ id: 'TriageCommentBody' });

export const AddTriageEvidenceBodySchema = EvidenceRef.meta({ id: 'AddTriageEvidenceBody' });

export const ListTriageQuerySchema = z
  .strictObject({
    program_id: z.uuid().optional(),
    status: TriageStatusSchema.optional(),
    kind: TriageKindSchema.optional(),
  })
  .meta({ id: 'ListTriageQuery' });

export const TriageItemSchema = z
  .object({
    id: z.uuid(),
    program_id: z.uuid(),
    program_code: z.string(),
    kind: TriageKindSchema,
    key: z.string(),
    label: z.string().nullable(),
    status: TriageStatusSchema,
    owner_id: z.uuid().nullable(),
    owner_name: z.string().nullable(),
    evidence_count: z.int(),
    comment_count: z.int(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .meta({ id: 'TriageItem' });
export type TriageItem = z.infer<typeof TriageItemSchema>;

export const TriageEvidenceSchema = z.object({
  id: z.uuid(),
  release_id: z.uuid(),
  dataset_name: z.string(),
  kind: z.string(),
  contrast_label: z.string().nullable(),
  /** Snapshot when added (differential abundance: the row of this protein). Releases are immutable, so it stays true. */
  log2_fc: z.number().nullable(),
  adj_p_value: z.number().nullable(),
  added_by: z.string().nullable(),
  added_at: z.string(),
});

export const TriageEventSchema = z.object({
  id: z.uuid(),
  type: z.enum(['created', 'status', 'owner', 'comment', 'evidence']),
  actor: z.string().nullable(),
  at: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** The reason (status), the comment, or a note. */
  text: z.string().nullable(),
});

export const TriageDetailSchema = TriageItemSchema.extend({
  evidence: z.array(TriageEvidenceSchema),
  events: z.array(TriageEventSchema),
}).meta({ id: 'TriageDetail' });
export type TriageDetail = z.infer<typeof TriageDetailSchema>;

export const TriageListSchema = z.object({ items: z.array(TriageItemSchema) }).meta({ id: 'TriageList' });
