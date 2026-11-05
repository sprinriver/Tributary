import { z } from 'zod';

// Usage analytics (Phase 36, USE-01…03): from the audit log and the registry; no new tracking.
export const UsageQuerySchema = z
  .strictObject({ weeks: z.coerce.number().int().min(1).max(52).default(12) })
  .meta({ id: 'UsageQuery' });

export const USAGE_MEASURES = [
  'active_users',
  'experiments_created',
  'versions_published',
  'imports',
  'releases_published',
  'pipeline_runs',
  'exports',
  'assistant',
  'triage',
] as const;

export const UsageWeekSchema = z.object({
  /** Monday (UTC) the week starts. */
  week_start: z.iso.date(),
  active_users: z.int(),
  experiments_created: z.int(),
  versions_published: z.int(),
  imports: z.int(),
  releases_published: z.int(),
  pipeline_runs: z.int(),
  exports: z.int(),
  assistant: z.int(),
  triage: z.int(),
});
export type UsageWeek = z.infer<typeof UsageWeekSchema>;

export const UsageSchema = z
  .object({
    generated_at: z.iso.datetime({ offset: true }),
    weeks: z.int(),
    totals: z.object({
      /** People who can sign in (not deactivated or deleted). */
      users: z.int(),
      active_7d: z.int(),
      active_30d: z.int(),
      /** People with no recorded action ever (e.g. provisioned, never signed in). */
      never_active: z.int(),
    }),
    weekly: z.array(UsageWeekSchema),
    programs: z.array(
      z.object({
        program_id: z.uuid(),
        program_code: z.string(),
        program_name: z.string(),
        experiments: z.int(),
        published_versions: z.int(),
        published_releases: z.int(),
        pipeline_runs: z.int(),
        last_activity: z.iso.datetime({ offset: true }).nullable(),
      }),
    ),
    users: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        email: z.string(),
        last_login_at: z.iso.datetime({ offset: true }).nullable(),
        last_active_at: z.iso.datetime({ offset: true }).nullable(),
        actions_30d: z.int(),
        status: z.enum(['active', 'deactivated']),
      }),
    ),
    /** What each measure counts. */
    definitions: z.record(z.string(), z.string()),
    figure: z.object({
      data: z.array(z.record(z.string(), z.unknown())),
      layout: z.record(z.string(), z.unknown()),
    }),
  })
  .meta({ id: 'Usage' });
export type Usage = z.infer<typeof UsageSchema>;
