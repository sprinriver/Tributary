import { z } from 'zod';

export const LINEAGE_KINDS = [
  'file',
  'dataset_release',
  'pipeline_run',
  'experiment_version',
  'chart',
] as const;
export const LineageKindSchema = z.enum(LINEAGE_KINDS);
export type LineageKind = z.infer<typeof LineageKindSchema>;

/** GET /v1/lineage (SPEC M10): the graph around one entity. */
export const LineageQuerySchema = z
  .object({
    kind: LineageKindSchema,
    id: z.uuid(),
    /** Steps to walk from the entity (each direction). */
    depth: z.coerce.number().int().min(1).max(6).optional(),
    direction: z.enum(['upstream', 'downstream', 'both']).optional(),
  })
  .meta({ id: 'LineageQuery' });
export type LineageQuery = z.input<typeof LineageQuerySchema>;

export const LineageGraphNodeSchema = z
  .object({
    kind: LineageKindSchema,
    id: z.uuid(),
    label: z.string(),
    /** e.g. pipeline repository @ revision, release dataset kind, file role. */
    detail: z.string(),
    status: z.string().nullable(),
    program_code: z.string().nullable(),
    /** Negative upstream, 0 the entity, positive downstream. */
    depth: z.int(),
  })
  .meta({ id: 'LineageGraphNode' });
export type LineageGraphNode = z.infer<typeof LineageGraphNodeSchema>;

export const LineageGraphSchema = z
  .object({
    root: z.object({ kind: LineageKindSchema, id: z.uuid() }),
    nodes: z.array(LineageGraphNodeSchema),
    /** `from`/`to` are node keys: `<kind>:<id>`. */
    edges: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        relation: z.enum(['input_to', 'produced', 'derived_from', 'describes']),
      }),
    ),
    /** True when the node cap was reached before the depth was. */
    truncated: z.boolean(),
  })
  .meta({ id: 'LineageGraph' });
export type LineageGraph = z.infer<typeof LineageGraphSchema>;
