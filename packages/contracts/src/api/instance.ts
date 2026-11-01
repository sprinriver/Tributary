import { z } from 'zod';

/** What the SPA needs to know about this installation (public; no secrets beyond published demo logins). */
export const InstanceInfoSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    /** A public demo: synthetic data, published logins, data reset on a schedule. */
    demo: z.boolean(),
    demo_logins: z.array(z.object({ username: z.string(), password: z.string() })),
    notice: z.string().nullable(),
  })
  .meta({ id: 'InstanceInfo' });
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;
