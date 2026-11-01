import type { z } from 'zod';

/**
 * Serialises a response through its contracts schema (Dates → ISO strings, unknown keys dropped), so responses
 * always match the published OpenAPI document. A mismatch is a server bug and surfaces as a 500.
 */
export function respond<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}
