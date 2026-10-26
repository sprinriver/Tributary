import { z } from 'zod';
import { UuidV7Schema } from './common.ts';
import { DatasetKindSchema } from './datasets/index.ts';

/** react-querybuilder operator names (https://react-querybuilder.js.org/docs/components/querybuilder#operators). */
export const OPERATORS = [
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'doesNotContain',
  'beginsWith',
  'endsWith',
  'in',
  'notIn',
  'between',
  'notBetween',
  'null',
  'notNull',
] as const;
export const OperatorSchema = z.enum(OPERATORS);
export type Operator = z.infer<typeof OperatorSchema>;

/** `column` for the primary source, `alias.column` for a joined table. */
export const ColumnRefSchema = z
  .string()
  .regex(/^([a-z][a-z0-9_]*\.)?[a-z][a-z0-9_]*$/, 'Expected column or alias.column');

export const RuleSchema = z
  .strictObject({
    id: z.string().optional(),
    field: ColumnRefSchema,
    operator: OperatorSchema,
    value: z.unknown().optional(),
  })
  .meta({ id: 'Rule' });
export type Rule = z.infer<typeof RuleSchema>;

export interface RuleGroup {
  id?: string | undefined;
  combinator: 'and' | 'or';
  not?: boolean | undefined;
  rules: (Rule | RuleGroup)[];
}

export const RuleGroupSchema: z.ZodType<RuleGroup> = z
  .strictObject({
    id: z.string().optional(),
    combinator: z.enum(['and', 'or']),
    not: z.boolean().optional(),
    get rules() {
      return z.array(z.union([RuleSchema, RuleGroupSchema]));
    },
  })
  .meta({ id: 'RuleGroup' });

export const SourceRefSchema = z
  .union([
    z.strictObject({ releaseIds: z.array(UuidV7Schema).min(1) }),
    z.strictObject({
      kind: DatasetKindSchema,
      scope: z.strictObject({
        programIds: z.array(UuidV7Schema).optional(),
        experimentVersionIds: z.array(UuidV7Schema).optional(),
        latestPublishedOnly: z.boolean().optional(),
      }),
    }),
  ])
  .meta({ id: 'SourceRef' });
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const JoinSchema = z
  .strictObject({
    type: z.enum(['inner', 'left', 'right']),
    target: SourceRefSchema,
    alias: z.string().regex(/^[a-z][a-z0-9_]*$/),
    on: z
      .array(
        z.strictObject({
          left: ColumnRefSchema,
          op: z.enum(['=', '!=', '>', '<', 'startsWith']),
          right: ColumnRefSchema,
        }),
      )
      .min(1),
    /** Filters the joined table inside its subquery, so LEFT joins keep their semantics (v1 parity). */
    where: RuleGroupSchema.optional(),
    /** Explode a list column of the primary source before joining (one row per accession / gene). */
    explode: z.enum(['protein_ids', 'gene_names']).optional(),
  })
  .meta({ id: 'Join' });
export type Join = z.infer<typeof JoinSchema>;

/** SPEC §7.1 — the only way to ask for data (UI, API, AI). Raw SQL is never accepted. */
export const QuerySpecSchema = z
  .strictObject({
    source: SourceRefSchema,
    joins: z.array(JoinSchema).optional(),
    where: RuleGroupSchema.optional(),
    select: z.array(ColumnRefSchema).optional(),
    orderBy: z.array(z.strictObject({ column: ColumnRefSchema, dir: z.enum(['asc', 'desc']) })).optional(),
    page: z
      .strictObject({
        size: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(500), z.literal(1000)]),
        cursor: z.string().optional(),
      })
      .optional(),
    limitRows: z.int().positive().optional(),
  })
  .meta({ id: 'QuerySpec' });
export type QuerySpec = z.infer<typeof QuerySpecSchema>;
