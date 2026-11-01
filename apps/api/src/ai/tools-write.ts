import { z } from 'zod';
import { suggestTerms } from './curation.ts';
import { checkSpec, ToolError, type AiTool, type ToolContext } from './tools.ts';

/** Ontology of each standard ontology-term sample field (packages/contracts template). */
export const FIELD_ONTOLOGY: Record<string, string> = {
  organism: 'NCBITaxon',
  cell_line: 'cellosaurus',
  tissue: 'UBERON',
  cell_type: 'CL',
  disease: 'EFO',
};

interface SampleList {
  items: { sample_key: string; raw: Record<string, string>; validation_errors: Record<string, string> }[];
}

const SuggestInput = z
  .object({
    ontology: z.string().min(1).max(50),
    values: z.array(z.string().min(1).max(200)).max(200).optional(),
    version_id: z.uuid().optional(),
    field: z.string().min(1).max(100).optional(),
  })
  .refine((i) => i.values?.length || (i.version_id && i.field), {
    message: 'Give values, or a version_id and field',
  });

/** Read and write tools for curation and saved views. Writes run only after the user approves them. */
export const WRITE_AND_CURATION_TOOLS: AiTool[] = [
  {
    name: 'suggest_ontology_terms',
    description:
      'Ontology terms for free-text values, from ontology lookups only. Give values, or a version_id and sample field to check that version\'s invalid values. Unknown values come back as "no match".',
    risk: 'read',
    input: SuggestInput,
    async run(ctx, input: z.infer<typeof SuggestInput>) {
      let values = input.values ?? [];
      if (input.version_id && input.field) {
        const samples = (await ctx.call('GET', `/v1/versions/${input.version_id}/samples`)) as SampleList;
        const field = input.field;
        values = [
          ...new Set(
            samples.items
              .filter((s) => s.validation_errors[field] && s.raw[field]?.trim())
              .map((s) => s.raw[field]!),
          ),
        ];
      }
      if (!values.length)
        return { ontology: input.ontology, sources: [], items: [], note: 'No values to check.' };
      return {
        ...(await suggestTerms(ctx, input.ontology, values.slice(0, 50))),
        version_id: input.version_id ?? null,
        field: input.field ?? null,
      };
    },
  },
  {
    name: 'create_saved_view',
    description:
      "Save a validated QuerySpec as a private saved view for the user. Needs the user's approval.",
    risk: 'write',
    input: z.object({ name: z.string().trim().min(1).max(200), query_spec: z.unknown() }),
    async run(ctx, input: { name: string; query_spec: unknown }, options?: { reason?: string }) {
      const spec = await checkSpec(ctx, input.query_spec);
      const view = (await ctx.call(
        'POST',
        '/v1/views',
        { name: input.name, query_spec: spec, visibility: 'private' },
        options,
      )) as { id: string; name: string };
      return { view_id: view.id, name: view.name };
    },
  },
  {
    name: 'apply_metadata_suggestions',
    description:
      "Replace free-text values of one sample field in a draft version with ontology terms. Each term must be one the ontology lookup returned for that value. Needs the user's approval.",
    risk: 'write',
    input: z.object({
      version_id: z.uuid(),
      field: z.string().min(1).max(100),
      ontology: z.string().min(1).max(50),
      changes: z
        .array(z.object({ from: z.string().min(1), term_id: z.string().min(1) }))
        .min(1)
        .max(200),
    }),
    async run(
      ctx,
      input: {
        version_id: string;
        field: string;
        ontology: string;
        changes: { from: string; term_id: string }[];
      },
      options?: { reason?: string },
    ) {
      // Re-check every term against a fresh lookup at approval time (SPEC §11.5).
      const labels = new Map<string, string>();
      for (const change of input.changes) {
        const [s] = (await suggestTerms(ctx as ToolContext, input.ontology, [change.from])).items;
        const term = [s?.term, ...(s?.candidates ?? [])].find((t) => t?.id === change.term_id);
        if (!term)
          throw new ToolError(
            `${change.term_id} was not returned by the ontology lookup for "${change.from}" (no match); nothing was changed.`,
          );
        labels.set(change.from, term.label);
      }
      const samples = (await ctx.call('GET', `/v1/versions/${input.version_id}/samples`)) as SampleList;
      const rows = samples.items
        .filter((s) => labels.has(s.raw[input.field] ?? ''))
        .map((s) => ({ ...s.raw, [input.field]: labels.get(s.raw[input.field]!)! }));
      if (!rows.length) throw new ToolError('No samples have those values any more; nothing was changed.');
      await ctx.call('PUT', `/v1/versions/${input.version_id}/samples`, { rows }, options);
      return { version_id: input.version_id, field: input.field, samples_changed: rows.length };
    },
  },
];
