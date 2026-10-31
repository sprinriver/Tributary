import { z } from 'zod';
import { ChartSpecSchema } from '../charts.ts';
import { TimestampSchema } from '../common.ts';
import { QuerySpecSchema } from '../query.ts';

// SPEC M6 saved views: a query (and optional chart) saved privately or for a program; links honour permissions.

export const CreateViewBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    query_spec: QuerySpecSchema,
    chart_spec: ChartSpecSchema.nullable().optional(),
    visibility: z.enum(['private', 'program']),
    /** Required for program visibility: the program whose members may open the view. */
    program_id: z.uuid().optional(),
  })
  .refine((v) => v.visibility === 'private' || v.program_id !== undefined, {
    message: 'Program views need a program',
    path: ['program_id'],
  })
  .meta({ id: 'CreateViewBody' });
export type CreateViewBody = z.infer<typeof CreateViewBodySchema>;

export const ViewSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    owner: z.uuid(),
    owner_name: z.string().nullable(),
    program_id: z.uuid().nullable(),
    visibility: z.enum(['private', 'program']),
    query_spec: QuerySpecSchema,
    chart_spec: ChartSpecSchema.nullable(),
    created_at: TimestampSchema,
    updated_at: TimestampSchema,
  })
  .meta({ id: 'View' });
export type View = z.infer<typeof ViewSchema>;

export const ViewListSchema = z.object({ items: z.array(ViewSchema) }).meta({ id: 'ViewList' });
