import { z } from 'zod';
import { TimestampSchema } from '../common.ts';
import { IngestStatusSchema } from '../entities/platform.ts';

// SPEC M3 — files and ingest: presigned multipart upload, link-by-prefix, sniffers, QC, gate, lifecycle.

export type IngestStatus = z.infer<typeof IngestStatusSchema>;

/**
 * Legal ingest transitions (SPEC §7.3). Uploads go registered → uploading → uploaded; linked objects skip
 * `uploading`. The ingest job moves uploaded → type_detected → contract_validated → qc_passed | qc_failed and may
 * fail early (type_detected → qc_failed) when the content contradicts the declared format. Aborted uploads end in
 * `rejected`. `published` is reached when a dataset release takes the file (Phase 8).
 */
export const INGEST_TRANSITIONS: Readonly<Record<IngestStatus, readonly IngestStatus[]>> = {
  registered: ['uploading', 'uploaded', 'rejected'],
  uploading: ['uploaded', 'rejected'],
  uploaded: ['type_detected', 'rejected'],
  type_detected: ['contract_validated', 'qc_failed'],
  contract_validated: ['qc_passed', 'qc_failed'],
  qc_passed: ['published', 'rejected'],
  qc_failed: ['rejected'],
  published: [],
  rejected: [],
};

export const canTransition = (from: IngestStatus, to: IngestStatus): boolean =>
  INGEST_TRANSITIONS[from].includes(to);

/** Statuses the ingest job has not finished with yet. */
export const INGEST_IN_PROGRESS: readonly IngestStatus[] = [
  'registered',
  'uploading',
  'uploaded',
  'type_detected',
  'contract_validated',
];

/** What a file is for; drives lifecycle tags (SPEC M3). */
export const FileRoleSchema = z.enum(['raw', 'processed', 'metadata', 'other']).meta({ id: 'FileRole' });
export type FileRole = z.infer<typeof FileRoleSchema>;

/** Formats the sniffers recognise. Compression (gzip/BGZF) is reported separately. */
export const FileFormatSchema = z
  .enum([
    'fastq',
    'vcf',
    'bam',
    'csv',
    'tsv',
    'parquet',
    'zip',
    'mzml',
    'thermo_raw',
    'bruker_tdf',
    'bruker_tdf_bin',
    'bruker_baf',
    'sciex_wiff',
    'sciex_wiff_scan',
    'text',
    'binary',
  ])
  .meta({ id: 'FileFormat' });
export type FileFormat = z.infer<typeof FileFormatSchema>;

export const CompressionSchema = z.enum(['none', 'gzip', 'bgzf']);
export type Compression = z.infer<typeof CompressionSchema>;

export const QcCheckSchema = z.object({
  id: z.string(),
  passed: z.boolean(),
  message: z.string(),
  /** Where the rule comes from (format specification). */
  source: z.string(),
});
export type QcCheck = z.infer<typeof QcCheckSchema>;

export const QcReportSchema = z
  .object({
    format: FileFormatSchema,
    compression: CompressionSchema,
    /** How the format was decided: content signature, file structure, or file extension only. */
    detected_by: z.enum(['signature', 'structure', 'extension', 'fallback']),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size_bytes: z.int().nonnegative(),
    checks: z.array(QcCheckSchema),
    passed: z.boolean(),
    checked_at: TimestampSchema,
  })
  .meta({ id: 'QcReport' });
export type QcReport = z.infer<typeof QcReportSchema>;

export const FileSummarySchema = z
  .object({
    id: z.uuid(),
    experiment_version_id: z.uuid().nullable(),
    name: z.string(),
    role: FileRoleSchema,
    bucket: z.string(),
    key: z.string(),
    size_bytes: z.int().nonnegative(),
    sha256: z.string().nullable(),
    format: z.string().nullable(),
    declared_format: z.string().nullable(),
    ingest_status: IngestStatusSchema,
    /** First failed QC check, for display. */
    qc_reason: z.string().nullable(),
    qc_report: QcReportSchema.nullable(),
    lifecycle_tag: z.string().nullable(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
  })
  .meta({ id: 'FileSummary' });
export type FileSummary = z.infer<typeof FileSummarySchema>;

export const FileListSchema = z.object({ items: z.array(FileSummarySchema) }).meta({ id: 'FileList' });

/** S3 allows 10,000 parts of up to 5 GiB; objects up to 5 TiB (SPEC M3). */
export const MAX_FILE_BYTES = 5 * 1024 ** 4;
const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^/\\\0]+$/, 'A file name cannot contain slashes')
  .refine((name) => name !== '.' && name !== '..', 'Not a file name');

export const InitiateUploadBodySchema = z
  .strictObject({
    experiment_version_id: z.uuid(),
    name: FileNameSchema,
    size_bytes: z.int().positive().max(MAX_FILE_BYTES),
    role: FileRoleSchema.default('raw'),
    declared_format: FileFormatSchema.optional(),
  })
  .meta({ id: 'InitiateUploadBody' });

export const PresignedPartSchema = z.object({ part_number: z.int().min(1).max(10_000), url: z.url() });

export const InitiateUploadResponseSchema = z
  .object({
    file: FileSummarySchema,
    upload_id: z.string(),
    part_size: z.int().positive(),
    part_count: z.int().positive(),
    parts: z.array(PresignedPartSchema),
    expires_at: TimestampSchema,
  })
  .meta({ id: 'InitiateUploadResponse' });
export type InitiateUploadResponse = z.infer<typeof InitiateUploadResponseSchema>;

export const SignPartsBodySchema = z
  .strictObject({ part_numbers: z.array(z.int().min(1).max(10_000)).min(1).max(1000) })
  .meta({ id: 'SignPartsBody' });

export const SignedPartsSchema = z
  .object({ parts: z.array(PresignedPartSchema), expires_at: TimestampSchema })
  .meta({ id: 'SignedParts' });

export const UploadedPartsSchema = z
  .object({
    upload_id: z.string(),
    part_size: z.int().positive(),
    part_count: z.int().positive(),
    parts: z.array(
      z.object({ part_number: z.int().positive(), etag: z.string(), size_bytes: z.int().nonnegative() }),
    ),
  })
  .meta({ id: 'UploadedParts' });
export type UploadedParts = z.infer<typeof UploadedPartsSchema>;

export const CompleteUploadBodySchema = z
  .strictObject({
    parts: z
      .array(z.strictObject({ part_number: z.int().min(1).max(10_000), etag: z.string().min(1).max(200) }))
      .min(1)
      .max(10_000),
  })
  .meta({ id: 'CompleteUploadBody' });

export const LinkPrefixBodySchema = z
  .strictObject({
    experiment_version_id: z.uuid(),
    prefix: z
      .string()
      .trim()
      .min(1)
      .max(1024)
      .refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'Not a valid prefix'),
    role: FileRoleSchema.default('raw'),
  })
  .meta({ id: 'LinkPrefixBody' });

export const LinkPrefixResultSchema = z
  .object({ items: z.array(FileSummarySchema), skipped: z.int().nonnegative() })
  .meta({ id: 'LinkPrefixResult' });

export const QcOverrideBodySchema = z
  .strictObject({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(2000) })
  .meta({ id: 'QcOverrideBody' });

export const QcOverrideSchema = z
  .object({
    id: z.uuid(),
    experiment_version_id: z.uuid(),
    reason: z.string(),
    /** The failed files this override covers; files that fail later need a new override. */
    file_ids: z.array(z.uuid()),
    created_by: z.uuid(),
    created_by_name: z.string().nullable(),
    created_at: TimestampSchema,
  })
  .meta({ id: 'QcOverride' });
export type QcOverride = z.infer<typeof QcOverrideSchema>;

export const QcGateSchema = z
  .object({
    can_launch: z.boolean(),
    blockers: z.array(
      z.object({
        file_id: z.uuid(),
        name: z.string(),
        status: IngestStatusSchema,
        reason: z.string(),
      }),
    ),
    /** Failed files an approver has overridden. */
    overridden: z.array(z.uuid()),
    override: QcOverrideSchema.nullable(),
  })
  .meta({ id: 'QcGate' });
export type QcGate = z.infer<typeof QcGateSchema>;

/** Roles a lifecycle policy can target: file roles plus pipeline work dirs and user exports (ARCHITECTURE §5). */
export const LifecycleRoleSchema = z.enum(['raw', 'processed', 'metadata', 'other', 'work', 'export']);
export const StorageClassSchema = z.enum([
  'STANDARD_IA',
  'INTELLIGENT_TIERING',
  'GLACIER_IR',
  'GLACIER',
  'DEEP_ARCHIVE',
]);

export const LifecyclePolicySchema = z
  .object({
    role: LifecycleRoleSchema,
    /** Value of the `tributary-lifecycle` object tag; bucket rules filter on it. */
    tag: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Lower-case letters, digits and dashes'),
    transition_days: z.int().min(1).max(36_500).nullable(),
    storage_class: StorageClassSchema.nullable(),
    expiration_days: z.int().min(1).max(36_500).nullable(),
  })
  .refine((p) => (p.transition_days === null) === (p.storage_class === null), {
    message: 'Set both a transition day count and a storage class, or neither',
    path: ['storage_class'],
  })
  // S3 lifecycle: transitions to STANDARD_IA need objects at least 30 days old (S3 User Guide, "Transitioning
  // objects using Amazon S3 Lifecycle", constraints).
  .refine((p) => p.storage_class !== 'STANDARD_IA' || (p.transition_days ?? 0) >= 30, {
    message: 'S3 moves objects to STANDARD_IA only after at least 30 days',
    path: ['transition_days'],
  })
  .refine((p) => !p.expiration_days || !p.transition_days || p.expiration_days > p.transition_days, {
    message: 'Expiry must come after the transition',
    path: ['expiration_days'],
  })
  .meta({ id: 'LifecyclePolicy' });
export type LifecyclePolicy = z.infer<typeof LifecyclePolicySchema>;

export const LifecyclePoliciesBodySchema = z
  .strictObject({ items: z.array(LifecyclePolicySchema).min(1).max(20) })
  .refine((b) => new Set(b.items.map((i) => i.role)).size === b.items.length, {
    message: 'One policy per role',
    path: ['items'],
  })
  .meta({ id: 'LifecyclePoliciesBody' });

/** An S3 lifecycle rule (PutBucketLifecycleConfiguration shape) generated from a policy, for infra/terraform. */
export const S3LifecycleRuleSchema = z.object({
  ID: z.string(),
  Status: z.literal('Enabled'),
  Filter: z.object({ Tag: z.object({ Key: z.string(), Value: z.string() }) }),
  Transitions: z.array(z.object({ Days: z.int(), StorageClass: StorageClassSchema })).optional(),
  Expiration: z.object({ Days: z.int() }).optional(),
});

export const LifecyclePoliciesSchema = z
  .object({ items: z.array(LifecyclePolicySchema), s3_rules: z.array(S3LifecycleRuleSchema) })
  .meta({ id: 'LifecyclePolicies' });
export type LifecyclePolicies = z.infer<typeof LifecyclePoliciesSchema>;

export const LIFECYCLE_TAG_KEY = 'tributary-lifecycle';
export const ROLE_TAG_KEY = 'tributary-role';

/** S3 lifecycle rules for the policies (one rule per policy that transitions or expires). */
export function lifecycleRules(
  policies: readonly LifecyclePolicy[],
): z.infer<typeof S3LifecycleRuleSchema>[] {
  return policies
    .filter((p) => p.transition_days !== null || p.expiration_days !== null)
    .map((p) => ({
      ID: `tributary-${p.role}`,
      Status: 'Enabled' as const,
      Filter: { Tag: { Key: LIFECYCLE_TAG_KEY, Value: p.tag } },
      ...(p.transition_days !== null && p.storage_class
        ? { Transitions: [{ Days: p.transition_days, StorageClass: p.storage_class }] }
        : {}),
      ...(p.expiration_days !== null ? { Expiration: { Days: p.expiration_days } } : {}),
    }));
}
