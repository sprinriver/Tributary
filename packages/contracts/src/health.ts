import { z } from 'zod';

/** Response of every service's `/healthz` endpoint. */
export const HealthStatusSchema = z.object({
  service: z.string().min(1),
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string().min(1),
});
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
