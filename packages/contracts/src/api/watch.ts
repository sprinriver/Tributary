import { z } from 'zod';

// Watchlists and alerts (Phase 26, WAT-01…03): follow a protein, gene or compound; get an alert when a newly
// published release you can read has a hit for it.

export const WatchKindSchema = z.enum(['protein', 'gene', 'compound']);

/** What counts as a hit for an alert (the results pages' display thresholds). */
export const ALERT_HIT_RULE = { adj_p_max: 0.05, abs_log2fc_min: 1 } as const;

export const CreateWatchBodySchema = z
  .strictObject({
    kind: WatchKindSchema,
    /** UniProt accession, gene symbol or compound id. */
    key: z.string().trim().min(1).max(100),
    label: z.string().trim().max(200).optional(),
  })
  .meta({ id: 'CreateWatchBody' });

export const WatchSchema = z
  .object({
    id: z.uuid(),
    kind: WatchKindSchema,
    key: z.string(),
    label: z.string().nullable(),
    created_at: z.string(),
  })
  .meta({ id: 'Watch' });
export type Watch = z.infer<typeof WatchSchema>;

export const WatchListSchema = z.object({ items: z.array(WatchSchema) }).meta({ id: 'WatchList' });

export const ListAlertsQuerySchema = z
  .strictObject({ unread_only: z.enum(['true', 'false']).optional() })
  .meta({ id: 'ListAlertsQuery' });

export const AlertSchema = z
  .object({
    id: z.uuid(),
    watch: z.object({ id: z.uuid(), kind: WatchKindSchema, key: z.string(), label: z.string().nullable() }),
    release_id: z.uuid(),
    dataset_name: z.string(),
    program_code: z.string(),
    experiment_id: z.uuid().nullable(),
    experiment_name: z.string().nullable(),
    /** Differential abundance: the contrast ("numerator vs denominator") and the hit's values. */
    contrast_label: z.string().nullable(),
    log2_fc: z.number().nullable(),
    adj_p_value: z.number().nullable(),
    /** Why this is an alert, e.g. "adjusted p ≤ 0.05 and |log2 FC| ≥ 1". */
    rule: z.string(),
    created_at: z.string(),
    read_at: z.string().nullable(),
  })
  .meta({ id: 'Alert' });
export type Alert = z.infer<typeof AlertSchema>;

export const AlertListSchema = z
  .object({ items: z.array(AlertSchema), unread: z.int() })
  .meta({ id: 'AlertList' });
