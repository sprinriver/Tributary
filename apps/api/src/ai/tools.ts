import {
  ChartSpecSchema,
  DATASET_CONTRACTS,
  type ContractResolver,
  type DatasetKind,
  LineageKindSchema,
  QuerySpecSchema,
  resolveContractByKind,
  validateQuerySpec,
  type QuerySpec,
} from '@tributary/contracts';
import { z } from 'zod';
import type { ModelTool } from './provider.ts';

/** How a tool reaches the platform: the API itself, in-process, with the signed-in user's credentials. */
export interface ToolContext {
  call(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<unknown>;
}

export class ToolError extends Error {}

export interface AiTool {
  name: string;
  description: string;
  /** SPEC §11.2 risk class: reads run freely, compute is budgeted, writes need the user's approval (19b). */
  risk: 'read' | 'compute' | 'write';
  input: z.ZodType;
  run(ctx: ToolContext, input: never): Promise<unknown>;
}

/** Rows a query tool returns to the model (the Explorer shows the rest). */
export const MAX_TOOL_ROWS = 25;

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]): [string, string] => [k, String(v)]),
  ).toString();

/** base64url JSON, as the Explorer reads `?q=` (apps/web/src/explorer/spec.ts). */
export const explorerUrl = (spec: QuerySpec) =>
  `/explore?q=${Buffer.from(JSON.stringify(spec)).toString('base64url')}`;

/**
 * Validates a QuerySpec against the dataset contracts. Release-id sources are looked up through the API as the
 * user (an unreadable release reads as not found).
 */
async function checkSpec(ctx: ToolContext, raw: unknown): Promise<QuerySpec> {
  const parsed = QuerySpecSchema.safeParse(raw);
  if (!parsed.success)
    throw new ToolError(
      `Invalid QuerySpec: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
    );
  const sources = [parsed.data.source, ...(parsed.data.joins ?? []).map((j) => j.target)];
  const kinds = new Map<string, DatasetKind>();
  for (const id of new Set(sources.flatMap((s) => ('releaseIds' in s ? s.releaseIds : []))))
    kinds.set(id, ((await ctx.call('GET', `/v1/releases/${id}`)) as { kind: DatasetKind }).kind);
  const resolve: ContractResolver = (source) =>
    'releaseIds' in source
      ? DATASET_CONTRACTS[kinds.get(source.releaseIds[0]!)!]
      : resolveContractByKind(source);
  const errors = validateQuerySpec(parsed.data, resolve);
  if (errors.length)
    throw new ToolError(`Invalid QuerySpec: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
  return parsed.data;
}

/** First page only, at most MAX_TOOL_ROWS rows. */
const firstPage = (spec: QuerySpec): QuerySpec => ({ ...spec, page: { size: 25 } });

const SpecInput = z.object({
  query_spec: z.unknown().describe('A QuerySpec (source, where, select, orderBy)'),
});
const Id = z.object({ id: z.uuid() });

export const TOOLS: AiTool[] = [
  {
    name: 'search_experiments',
    description:
      'Search experiments in the programs the user can read (cell lines, compounds, assay types, free text). Returns experiment names and why they matched.',
    risk: 'read',
    input: z.object({ query: z.string().min(1).max(200), limit: z.int().min(1).max(20).optional() }),
    async run(ctx, input: { query: string; limit?: number }) {
      const res = (await ctx.call('GET', `/v1/search?${qs({ q: input.query, limit: 50 })}`)) as {
        items: {
          experiment_id: string;
          experiment_name: string;
          program_code: string;
          assay_type: string;
          status: string;
          title: string;
          snippet: string;
        }[];
        total: number;
      };
      const seen = new Map<string, Record<string, string>>();
      for (const h of res.items)
        if (!seen.has(h.experiment_id))
          seen.set(h.experiment_id, {
            id: h.experiment_id,
            name: h.experiment_name,
            program: h.program_code,
            assay_type: h.assay_type,
            status: h.status,
            matched: h.snippet,
          });
      return { experiments: [...seen.values()].slice(0, input.limit ?? 10) };
    },
  },
  {
    name: 'get_experiment',
    description: 'One experiment by id: assay type, program and its versions.',
    risk: 'read',
    input: Id,
    run: (ctx, input: { id: string }) => ctx.call('GET', `/v1/experiments/${input.id}`),
  },
  {
    name: 'list_datasets',
    description:
      'Datasets the user can read, with their latest release (id, status). Filter by kind or text.',
    risk: 'read',
    input: z.object({ kind: z.string().optional(), q: z.string().max(200).optional() }),
    async run(ctx, input: { kind?: string; q?: string }) {
      const res = (await ctx.call('GET', `/v1/datasets?${qs(input)}`)) as {
        items: {
          id: string;
          name: string;
          kind: string;
          experiment_name: string | null;
          latest_release: { id: string; status: string } | null;
        }[];
      };
      return {
        datasets: res.items.slice(0, 50).map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          experiment: d.experiment_name,
          latest_release: d.latest_release
            ? { id: d.latest_release.id, status: d.latest_release.status }
            : null,
        })),
      };
    },
  },
  {
    name: 'describe_release',
    description: 'A dataset release: its columns, row count, transformations and status.',
    risk: 'read',
    input: Id,
    run: (ctx, input: { id: string }) => ctx.call('GET', `/v1/releases/${input.id}`),
  },
  {
    name: 'build_query',
    description:
      'Validate a QuerySpec (never SQL) against the dataset contracts and return it with a link that opens it in the Explorer.',
    risk: 'read',
    input: SpecInput,
    async run(ctx, input: { query_spec: unknown }) {
      const spec = await checkSpec(ctx, input.query_spec);
      return { query_spec: spec, explorer_url: explorerUrl(spec) };
    },
  },
  {
    name: 'run_query',
    description: `Run a validated QuerySpec as the user and return the first ${MAX_TOOL_ROWS} rows.`,
    risk: 'read',
    input: SpecInput,
    async run(ctx, input: { query_spec: unknown }) {
      const spec = firstPage(await checkSpec(ctx, input.query_spec));
      const res = (await ctx.call('POST', '/v1/query', spec)) as {
        rows: unknown[];
        columns: unknown[];
        totalRows: number;
        totalCapped: boolean;
        sqlHash: string;
      };
      return {
        columns: res.columns,
        rows: res.rows.slice(0, MAX_TOOL_ROWS),
        total_rows: res.totalRows,
        total_capped: res.totalCapped,
        sql_hash: res.sqlHash,
        explorer_url: explorerUrl(spec),
      };
    },
  },
  {
    name: 'get_results_summary',
    description: 'Results of an experiment version: releases, contrasts, the run and its methods paragraph.',
    risk: 'read',
    input: z.object({ version_id: z.uuid() }),
    run: (ctx, input: { version_id: string }) => ctx.call('GET', `/v1/versions/${input.version_id}/results`),
  },
  {
    name: 'get_lineage',
    description: 'Upstream and downstream lineage of an entity (files, runs, releases, versions).',
    risk: 'read',
    input: z.object({ kind: LineageKindSchema, id: z.uuid(), depth: z.int().min(1).max(6).optional() }),
    run: (ctx, input: { kind: string; id: string; depth?: number }) =>
      ctx.call('GET', `/v1/lineage?${qs(input)}`),
  },
  {
    name: 'suggest_chart',
    description: 'Validate a ChartSpec from the chart registry and return it (the user renders it).',
    risk: 'read',
    input: z.object({ chart_spec: z.unknown() }),
    async run(_ctx, input: { chart_spec: unknown }) {
      const parsed = ChartSpecSchema.safeParse(input.chart_spec);
      if (!parsed.success)
        throw new ToolError(
          `Invalid ChartSpec: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
        );
      return { chart_spec: parsed.data };
    },
  },
  {
    name: 'render_chart',
    description: 'Render a ChartSpec through apps/compute; returns the chart provenance and trace count.',
    risk: 'compute',
    input: z.object({ chart_spec: z.unknown() }),
    async run(ctx, input: { chart_spec: unknown }) {
      const res = (await ctx.call('POST', '/v1/charts/render', { spec: input.chart_spec })) as {
        figure?: { data?: unknown[] };
        provenance?: unknown;
      };
      return { traces: res.figure?.data?.length ?? 0, provenance: res.provenance ?? null };
    },
  },
];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);

/** Tool definitions as the model sees them (JSON Schema from zod). */
export const modelTools = (tools: AiTool[]): ModelTool[] =>
  tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
  }));
