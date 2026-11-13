import { z } from 'zod';
import { HealthReportSchema } from './admin-settings.ts';

// Support bundle (Phase 37, SUP-01): versions, health, a configuration summary and recent failures. No secrets or
// personal data: configuration is switches and host names only; failures carry no names or addresses.
const failures = <T extends z.ZodType>(item: T) => z.object({ count: z.int(), latest: z.array(item) });
const at = z.iso.datetime({ offset: true }).nullable();

export const SupportBundleSchema = z
  .object({
    generated_at: z.iso.datetime({ offset: true }),
    instance: z.object({
      name: z.string(),
      version: z.string(),
      build: z.string().nullable(),
      node: z.string(),
      platform: z.string(),
    }),
    database: z.object({
      postgres: z.string().nullable(),
      migrations_applied: z.array(z.string()),
      migrations_pending: z.array(z.string()),
    }),
    health: HealthReportSchema,
    /** Feature switches, counts and host names only. */
    configuration: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
    ),
    counts: z.object({
      users: z.int(),
      programs: z.int(),
      experiments: z.int(),
      notification_routes: z.int(),
    }),
    recent_failures: z.object({
      window_days: z.int(),
      pipeline_runs: failures(
        z.object({ id: z.uuid(), status: z.string(), pipeline: z.string().nullable(), at }),
      ),
      notification_deliveries: failures(
        z.object({
          kind: z.string(),
          event: z.string(),
          error: z.string().nullable(),
          attempts: z.int(),
          at,
        }),
      ),
      emails: failures(z.object({ event: z.string(), error: z.string().nullable(), attempts: z.int(), at })),
      imports_rejected: z.int(),
    }),
  })
  .meta({ id: 'SupportBundle' });
export type SupportBundle = z.infer<typeof SupportBundleSchema>;
